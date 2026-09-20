// Video → SBS pipeline. Browser-only: frames are sampled with <video> +
// canvas, depth-warped per frame (reuses the image estimator), then encoded
// to mp4/mkv with ffmpeg.wasm (libx264/libx265, software, silent for now).
import { FFmpeg } from "@ffmpeg/ffmpeg";
// Bundled same-origin (Vite emits these to dist): no CDN fetch at runtime,
// so Convert works offline / behind blockers. ESM build — the ffmpeg
// worker is type:module and falls back to `import()` for non-UMD cores.
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

export type VideoContainer = "mp4" | "mkv";
export type VideoCodec = "x264" | "x265";

export interface VideoMeta {
  url: string;
  duration: number;
  width: number;
  height: number;
}

let ffmpegSingleton: Promise<FFmpeg> | null = null;

/** Single-thread core (no COOP/COEP headers needed). Bundled ~30 MB, loaded once. */
export function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (!ffmpegSingleton) {
    ffmpegSingleton = (async () => {
      const ffmpeg = new FFmpeg();
      if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })();
    // Don't cache failed loads — retry should refetch.
    ffmpegSingleton.catch(() => (ffmpegSingleton = null));
  }
  return ffmpegSingleton;
}

/** Metadata probe via a temp <video> (no decoding of pixels yet). */
export function probeVideoObjectUrl(url: string): Promise<Omit<VideoMeta, "url">> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => reject(new Error("Could not read that video. Try an MP4/MKV/WebM."));
    v.src = url;
  });
}

const seekTo = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve, reject) => {
    const onSeek = () => {
      v.removeEventListener("seeked", onSeek);
      resolve();
    };
    v.addEventListener("seeked", onSeek);
    v.currentTime = t;
    setTimeout(() => reject(new Error("Video seek timed out.")), 15_000);
  });

export interface SampledFrames {
  frames: HTMLCanvasElement[];
  fps: number;
  width: number;
  height: number;
}

/**
 * Evenly sample up to maxFrames across duration, scaled to maxWidth.
 * ponytail: fixed even sampling + downscale cap (depth CNN dominates cost);
 * upgrade to scene-aware keyframes / full-res when quality demands it.
 */
export async function sampleVideoFrames(
  url: string,
  opts: { maxFrames?: number; targetFps?: number; maxWidth?: number } = {},
): Promise<SampledFrames> {
  const { maxFrames = 480, targetFps = 30, maxWidth = 512 } = opts;
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error("Could not decode that video."));
  });
  await v.play().catch(() => {});
  v.pause();

  const duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video has no duration.");
  const n = Math.max(1, Math.min(maxFrames, Math.round(duration * targetFps)));
  const scale = Math.min(1, maxWidth / (v.videoWidth || maxWidth));
  const w = Math.max(2, Math.round(v.videoWidth * scale));
  const h = Math.max(2, Math.round(v.videoHeight * scale));

  const frames: HTMLCanvasElement[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : Math.min(duration - 0.05, (i / (n - 1)) * (duration - 0.1) + 0.05);
    await seekTo(v, t);
    ctx.drawImage(v, 0, 0, w, h);
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    copy.getContext("2d")!.drawImage(canvas, 0, 0);
    frames.push(copy);
  }
  v.src = "";
  return { frames, fps: n / duration, width: w, height: h };
}

/** JPEG bytes for one canvas (smaller than PNG for the ffmpeg FS). */
export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.85): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Frame encode failed."));
          return;
        }
        blob
          .arrayBuffer()
          .then((ab) => resolve(new Uint8Array(ab)))
          .catch(reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

const pad3 = (i: number) => String(i + 1).padStart(3, "0");

/**
 * Encode a JPEG image sequence to mp4/mkv. Silent (no audio) for now.
 * ponytail: single CRF/preset pair per codec; expose knobs when asked.
 */
export async function encodeFramesToVideo(
  frames: Uint8Array[],
  fps: number,
  container: VideoContainer,
  codec: VideoCodec,
  onLog?: (msg: string) => void,
): Promise<Blob> {
  if (frames.length === 0) throw new Error("No frames to encode.");
  const ffmpeg = await getFFmpeg(onLog);
  const outName = `out.${container}`;
  const vcodec = codec === "x264" ? "libx264" : "libx265";
  try {
    for (let i = 0; i < frames.length; i++) {
      await ffmpeg.writeFile(`f${pad3(i)}.jpg`, frames[i]);
    }
    const args = [
      "-framerate",
      String(Math.max(1, Math.round(fps))),
      "-i",
      "f%03d.jpg",
      "-c:v",
      vcodec,
      "-pix_fmt",
      "yuv420p",
      "-crf",
      codec === "x264" ? "20" : "24",
      "-preset",
      "veryfast",
    ];
    if (container === "mp4") args.push("-movflags", "+faststart");
    args.push(outName);
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`Encoder exited with code ${code}.`);
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    // Copy out of the wasm heap before deleting.
    const bytes = new Uint8Array(data);
    return new Blob([bytes.buffer as ArrayBuffer], {
      type: container === "mp4" ? "video/mp4" : "video/x-matroska",
    });
  } catch (e) {
    throw new Error(
      codec === "x265"
        ? `x265 encode failed (heavy in wasm — try x264): ${e instanceof Error ? e.message : String(e)}`
        : `Encode failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    for (let i = 0; i < frames.length; i++) {
      try {
        await ffmpeg.deleteFile(`f${pad3(i)}.jpg`);
      } catch {
        /* best-effort cleanup */
      }
    }
    try {
      await ffmpeg.deleteFile(outName);
    } catch {
      /* may not exist on failure */
    }
  }
}
