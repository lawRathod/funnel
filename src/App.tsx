import { createEffect, createSignal, onMount, Show } from "solid-js";
import {
  Boxes,
  ShieldCheck,
  Download,
  RotateCcw,
  Wand2,
  AlertTriangle,
  Image as ImageIcon,
  Brain,
  Film,
} from "lucide-solid";
import Dropzone from "./components/Dropzone";
import SettingsPanel from "./components/SettingsPanel";
import { checkWebGpuSupport, DEPTH_MODELS } from "./lib/models";
import type { DepthResult } from "./lib/depth";
import {
  canvasToPngBlob,
  drawDepthMap,
  imageToCanvas,
  loadFileAsImage,
  loadUrlAsImage,
  renderSbsFromDepth,
} from "./lib/sbs";
import type { OutputFormat, PipelineStatus } from "./lib/types";
import type { VideoCodec, VideoContainer, VideoMeta } from "./lib/video";

const SAMPLE_URL = "https://picsum.photos/seed/depthsbs-3d/1280/800";

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [sourceImg, setSourceImg] = createSignal<HTMLImageElement | null>(null);
  const [sourceUrl, setSourceUrl] = createSignal<string>("");
  const [sourceName, setSourceName] = createSignal<string>("sample.jpg");
  const [depth, setDepth] = createSignal<DepthResult | null>(null);

  const [baseline, setBaseline] = createSignal(28);
  const [swapEyes, setSwapEyes] = createSignal(false);
  const [format, setFormat] = createSignal<OutputFormat>("sbs-half");
  const [modelId, setModelId] = createSignal(DEPTH_MODELS[0].id);

  const [webGpu, setWebGpu] = createSignal<boolean | null>(null);
  const [usedDevice, setUsedDevice] = createSignal<"webgpu" | "wasm" | null>(null);
  const [status, setStatus] = createSignal<PipelineStatus>("idle");
  const [progress, setProgress] = createSignal<number | null>(null);
  const [depthMs, setDepthMs] = createSignal<number | null>(null);
  const [sbsMs, setSbsMs] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loadingSample, setLoadingSample] = createSignal(false);

  // Video → SBS state (image path above stays untouched).
  const [mediaKind, setMediaKind] = createSignal<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = createSignal<string>("");
  const [videoName, setVideoName] = createSignal<string>("");
  const [videoMeta, setVideoMeta] = createSignal<VideoMeta | null>(null);
  const [container, setContainer] = createSignal<VideoContainer>("mp4");
  const [codec, setCodec] = createSignal<VideoCodec>("x264");
  const [vBusy, setVBusy] = createSignal(false);
  const [vStage, setVStage] = createSignal<string | null>(null);
  const [vFrac, setVFrac] = createSignal<number | null>(null);
  const [videoOutUrl, setVideoOutUrl] = createSignal<string | null>(null);

  let depthCanvasRef: HTMLCanvasElement | undefined;
  let sbsCanvasRef: HTMLCanvasElement | undefined;
  let lastObjectUrl: string | null = null;
  // Full-res pixel source for depth + warp (avoids re-decoding / taint issues).
  let srcCanvas: HTMLCanvasElement | null = null;
  let srcPixels: ImageData | null = null;

  onMount(() => {
    checkWebGpuSupport().then(setWebGpu);
  });

  const setSource = (img: HTMLImageElement, previewUrl: string, name: string) => {
    setSourceImg(img);
    setSourceUrl(previewUrl);
    setSourceName(name);
    setDepth(null);
    srcCanvas = imageToCanvas(img);
    srcPixels = srcCanvas.getContext("2d")!.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    setError(null);
    setStatus("idle");
    setProgress(null);
    setDepthMs(null);
    setSbsMs(null);
  };

  const handleFile = async (f: File) => {
    try {
      setError(null);
      if (f.type.startsWith("video/")) {
        await handleVideoFile(f);
        return;
      }
      const img = await loadFileAsImage(f);
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      const url = URL.createObjectURL(f);
      lastObjectUrl = url;
      clearVideo();
      setMediaKind("image");
      setSource(img, url, f.name);
    } catch (e) {
      setError(`Could not load file: ${errMsg(e)}`);
    }
  };

  const clearVideo = () => {
    const out = videoOutUrl();
    if (out) URL.revokeObjectURL(out);
    // NB: videoUrl() object URLs are revoked on replace/reset, not here,
    // so the <video> preview keeps working after selection.
    setVideoUrl("");
    setVideoName("");
    setVideoMeta(null);
    setVStage(null);
    setVFrac(null);
    setVideoOutUrl(null);
  };

  const handleVideoFile = async (f: File) => {
    const { probeVideoObjectUrl } = await import("./lib/video");
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    const url = URL.createObjectURL(f);
    lastObjectUrl = url;
    const meta = await probeVideoObjectUrl(url);
    clearVideo();
    setMediaKind("video");
    setVideoUrl(url);
    setVideoName(f.name);
    setVideoMeta({ url, ...meta });
    setStatus("idle");
  };

  const handleSample = async () => {
    try {
      setLoadingSample(true);
      setError(null);
      const img = await loadUrlAsImage(SAMPLE_URL);
      setSource(img, img.src, "sample.jpg");
    } catch (e) {
      setError(`Could not load sample: ${errMsg(e)}`);
    } finally {
      setLoadingSample(false);
    }
  };

  const handleConvert = async () => {
    const img = sourceImg();
    if (!img || !srcCanvas || !srcPixels) {
      setError("Upload an image first.");
      return;
    }
    const model = DEPTH_MODELS.find((m) => m.id === modelId()) ?? DEPTH_MODELS[0];
    try {
      setError(null);
      setDepth(null);
      setDepthMs(null);
      setSbsMs(null);

      // 1. Load (or reuse cached) depth model — WebGPU first, WASM fallback.
      // Lazy import: keeps transformers.js + onnxruntime out of first paint.
      setStatus("loading-model");
      setProgress(0);
      const { getDepthEstimator, estimateDepth } = await import("./lib/depth");
      const devices: ("webgpu" | "wasm")[] = webGpu() ? ["webgpu", "wasm"] : ["wasm"];
      let estimator = null;
      let loadErr: unknown = null;
      for (const dev of devices) {
        try {
          estimator = await getDepthEstimator(model, dev, setProgress);
          setUsedDevice(dev);
          loadErr = null;
          break;
        } catch (e) {
          loadErr = e;
        }
      }
      if (!estimator) {
        throw new Error(`Could not load the depth model (tried ${devices.join(", ")}): ${errMsg(loadErr)}`);
      }

      // 2. Depth inference. First attempt can fail transiently on session
      // init (GPU warmup) while a retry succeeds — retry once, then surface.
      setStatus("estimating-depth");
      setProgress(null);
      const t0 = performance.now();
      let result: DepthResult;
      try {
        result = await estimateDepth(estimator, srcCanvas);
      } catch (firstErr) {
        console.warn("[depthsbs] depth inference failed once, retrying", firstErr);
        try {
          result = await estimateDepth(estimator, srcCanvas);
        } catch {
          throw new Error(`Depth inference failed: ${errMsg(firstErr)}`);
        }
      }
      setDepthMs(performance.now() - t0);
      setDepth(result);
      if (depthCanvasRef) drawDepthMap(result.gray, result.width, result.height, depthCanvasRef);

      // 3. Stereo warp + compose.
      setStatus("rendering");
      if (!sbsCanvasRef || !srcPixels) throw new Error("Stereo warp failed: preview canvas missing.");
      const t1 = performance.now();
      renderSbsFromDepth(srcPixels, result.norm, {
        baseline: baseline(),
        swapEyes: swapEyes(),
        format: format(),
      }, sbsCanvasRef);
      setSbsMs(performance.now() - t1);
      setStatus("done");
    } catch (e) {
      console.error("[depthsbs] convert failed", e);
      setStatus("error");
      setError(errMsg(e));
    }
  };

  // Live re-warp from cached depth when stereo settings change — no model re-run.
  createEffect(() => {
    const d = depth();
    if (status() === "done" && d && srcPixels && sbsCanvasRef) {
      try {
        const t = performance.now();
        renderSbsFromDepth(srcPixels, d.norm, {
          baseline: baseline(),
          swapEyes: swapEyes(),
          format: format(),
        }, sbsCanvasRef);
        setSbsMs(performance.now() - t);
      } catch {
        /* keep last good frame */
      }
    }
  });

  const handleDownload = async () => {
    if (!sbsCanvasRef || status() !== "done") return;
    try {
      const blob = await canvasToPngBlob(sbsCanvasRef);
      const url = URL.createObjectURL(blob);
      const base = sourceName().replace(/\.[a-z]+$/i, "") || "image";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}.${format()}.3d.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      console.error("[depthsbs] export failed", e);
      setError(`Export failed: ${errMsg(e)}`);
    }
  };

  const handleReset = () => {
    setSourceImg(null);
    setSourceUrl("");
    setDepth(null);
    srcCanvas = null;
    srcPixels = null;
    clearVideo();
    setMediaKind("image");
    setStatus("idle");
    setProgress(null);
    setDepthMs(null);
    setSbsMs(null);
    setError(null);
  };

  // Video → SBS: sample frames, depth + warp each, encode via ffmpeg.wasm.
  // ponytail: even sampling, ≤480 frames @ 30fps, ≤512px wide, silent output;
  // raise caps / keep audio when quality demands it.
  const handleConvertVideo = async () => {
    const meta = videoMeta();
    const url = videoUrl();
    if (!meta || !url || vBusy()) return;
    const model = DEPTH_MODELS.find((m) => m.id === modelId()) ?? DEPTH_MODELS[0];
    setVBusy(true);
    setError(null);
    const out = videoOutUrl();
    if (out) URL.revokeObjectURL(out);
    setVideoOutUrl(null);
    try {
      const { getDepthEstimator, estimateDepth } = await import("./lib/depth");
      const { sampleVideoFrames, canvasToJpegBytes, encodeFramesToVideo } = await import("./lib/video");

      setVStage("Loading depth model");
      setVFrac(null);
      const devices: ("webgpu" | "wasm")[] = webGpu() ? ["webgpu", "wasm"] : ["wasm"];
      let estimator = null;
      let loadErr: unknown = null;
      for (const dev of devices) {
        try {
          estimator = await getDepthEstimator(model, dev, (f) => {
            if (Number.isFinite(f)) setVFrac(f * 0.1);
          });
          setUsedDevice(dev);
          loadErr = null;
          break;
        } catch (e) {
          loadErr = e;
        }
      }
      if (!estimator) throw new Error(`Could not load the depth model: ${errMsg(loadErr)}`);

      setVStage("Sampling frames");
      const { frames, fps } = await sampleVideoFrames(url);
      const sbsCanvas = document.createElement("canvas");
      const jpgs: Uint8Array[] = [];
      for (let i = 0; i < frames.length; i++) {
        setVStage(`Depth + SBS · frame ${i + 1}/${frames.length}`);
        setVFrac(0.1 + (0.7 * i) / frames.length);
        const fc = frames[i];
        const pixels = fc.getContext("2d")!.getImageData(0, 0, fc.width, fc.height);
        const depthRes = await estimateDepth(estimator, fc);
        renderSbsFromDepth(pixels, depthRes.norm, {
          baseline: baseline(),
          swapEyes: swapEyes(),
          format: format(),
        }, sbsCanvas);
        if (i === 0 && sbsCanvasRef) {
          sbsCanvasRef.width = sbsCanvas.width;
          sbsCanvasRef.height = sbsCanvas.height;
          sbsCanvasRef.getContext("2d")!.drawImage(sbsCanvas, 0, 0);
        }
        jpgs.push(await canvasToJpegBytes(sbsCanvas));
      }

      setVStage(`Encoding ${container().toUpperCase()} · ${codec()} (ffmpeg.wasm, slow)`);
      setVFrac(0.85);
      const blob = await encodeFramesToVideo(jpgs, fps, container(), codec(), (msg) => {
        if (/x265|error|failed/i.test(msg)) console.warn("[depthsbs] ffmpeg:", msg);
      });
      setVFrac(1);
      setVideoOutUrl(URL.createObjectURL(blob));
      setVStage("Done");
    } catch (e) {
      console.error("[depthsbs] video convert failed", e);
      setError(errMsg(e));
      setVStage("Failed");
    } finally {
      setVBusy(false);
    }
  };

  const busy = () => status() === "loading-model" || status() === "estimating-depth" || status() === "rendering";
  const statusLabel = () => {
    switch (status()) {
      case "loading-model": return Number.isFinite(progress()) ? `Downloading model · ${Math.round(progress()! * 100)}%` : "Loading model";
      case "estimating-depth": return "Estimating depth";
      case "rendering": return "Warping stereo pair";
      case "done": return "Done";
      case "error": return "Failed";
      default: return "Idle";
    }
  };

  return (
    <div class="min-h-screen hero-grid-bg">
      {/* ── Navbar ─────────────────────────────────── */}
      <header class="navbar max-w-5xl mx-auto px-4 pt-4">
        <div class="flex-1 flex items-center gap-2.5">
          <div class="bg-neutral text-neutral-content rounded-lg p-2">
            <Boxes size={18} />
          </div>
          <div>
            <p class="font-semibold tracking-tight leading-none">DepthSBS</p>
            <p class="text-[11px] opacity-50 leading-none mt-0.5">2D → 3D · browser-only</p>
          </div>
        </div>
        <div class="flex-none flex items-center gap-3">
          <span class="text-xs opacity-60 hidden md:inline-flex items-center gap-1.5">
            <ShieldCheck size={13} /> Private — no uploads
          </span>
          <a
            class="link link-hover text-xs opacity-60"
            href="https://huggingface.co/onnx-community/depth-anything-v2-small"
            target="_blank"
            rel="noreferrer"
          >
            HF model
          </a>
        </div>
      </header>

      <main class="max-w-5xl mx-auto px-4 pb-14">
        {/* ── Hero ─────────────────────────────────── */}
        <section class="text-center pt-10 pb-8 max-w-2xl mx-auto">
          <p class="text-[11px] font-medium uppercase tracking-[0.22em] opacity-45 mb-3">
            Browser-only 2D → 3D
          </p>
          <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight text-balance">
            Turn 2D photos & video into 3D SBS
          </h1>
          <p class="opacity-60 mt-3 text-[15px]">
            On-device depth estimation. No uploads, no queue — export side-by-side
            PNG or {"MP4 / MKV (x264 / x265)"} for VR headsets and 3D TVs.
          </p>

          <ul class="steps steps-horizontal w-full max-w-md mx-auto mt-6 text-xs">
            <li class={`step ${sourceImg() ? "step-primary" : ""}`}>Upload</li>
            <li class={`step ${status() === "done" ? "step-primary" : ""}`}>Depth + SBS</li>
            <li class="step">Export</li>
          </ul>
        </section>

        <Show when={error()}>
          <div role="alert" class="alert alert-error alert-soft mb-4 text-sm">
            <AlertTriangle size={16} />
            <span>{error()}</span>
            <button class="btn btn-xs btn-ghost ml-auto" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </Show>

        {/* ── Workspace ────────────────────────────── */}
        <section class="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div class="flex flex-col gap-4">
            <Dropzone
              onFile={handleFile}
              onSample={handleSample}
              loadingSample={loadingSample()}
              hasImage={!!sourceImg() || !!videoMeta()}
            />
            {/* Media toggle — reflects what was dropped */}
            <div class="join w-full">
              <button
                class={`btn btn-sm join-item flex-1 ${mediaKind() === "image" ? "btn-active" : ""}`}
                onClick={() => setMediaKind("image")}
              >
                Photo
              </button>
              <button
                class={`btn btn-sm join-item flex-1 ${mediaKind() === "video" ? "btn-active" : ""}`}
                onClick={() => setMediaKind("video")}
              >
                <Film size={14} /> Video
              </button>
            </div>
            <SettingsPanel
              baseline={baseline()}
              setBaseline={setBaseline}
              swapEyes={swapEyes()}
              setSwapEyes={setSwapEyes}
              format={format()}
              setFormat={setFormat}
              modelId={modelId()}
              setModelId={(v) => { setModelId(v); setStatus("idle"); }}
              webGpu={webGpu()}
            />

            <Show when={mediaKind() === "video"}>
              <div class="grid grid-cols-2 gap-2">
                <label class="form-control">
                  <span class="label label-text text-[11px] opacity-60">Container</span>
                  <select
                    class="select select-sm select-bordered"
                    value={container()}
                    onChange={(e) => setContainer(e.currentTarget.value as VideoContainer)}
                  >
                    <option value="mp4">MP4</option>
                    <option value="mkv">MKV</option>
                  </select>
                </label>
                <label class="form-control">
                  <span class="label label-text text-[11px] opacity-60">Codec</span>
                  <select
                    class="select select-sm select-bordered"
                    value={codec()}
                    onChange={(e) => setCodec(e.currentTarget.value as VideoCodec)}
                  >
                    <option value="x264">x264 (fast)</option>
                    <option value="x265">x265 (slow)</option>
                  </select>
                </label>
              </div>
              <p class="text-[11px] opacity-50">
                30 fps · ≤480 frames · ≤512px · silent · x265 is 5–10× slower in wasm.
              </p>
            </Show>

            <Show
              when={mediaKind() === "video"}
              fallback={
            <button
              class="btn btn-primary w-full"
              onClick={handleConvert}
              disabled={!sourceImg() || busy()}
            >
              {busy() ? (
                <span class="loading loading-spinner loading-sm" />
              ) : (
                <Wand2 size={16} />
              )}
              {status() === "done" ? "Re-run depth" : "Convert to 3D"}
            </button>
              }
            >
              <button
                class="btn btn-primary w-full"
                onClick={handleConvertVideo}
                disabled={!videoMeta() || vBusy()}
              >
                {vBusy() ? (
                  <span class="loading loading-spinner loading-sm" />
                ) : (
                  <Wand2 size={16} />
                )}
                Convert video to 3D
              </button>
            </Show>
            <div class="flex items-center justify-between">
              <p class="text-[11px] opacity-50">
                Model downloads once (~30 MB), then runs offline.
              </p>
              <button
                class="btn btn-xs btn-ghost opacity-60"
                onClick={handleReset}
                disabled={!sourceImg() && !videoMeta()}
                title="Clear"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>

          {/* Right: input | output + SBS */}
          <div class="card bg-base-100 border border-base-content/10 rounded-2xl overflow-hidden">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4 text-xs">
              <span class="opacity-60">{statusLabel()}</span>
              <Show when={usedDevice()}>
                <span class="opacity-60">· {usedDevice() === "webgpu" ? "WebGPU" : "WASM"}</span>
              </Show>
              <Show when={depthMs() != null}>
                <span class="opacity-60 tabular-nums">
                  · depth {fmtMs(depthMs()!)}
                  <Show when={sbsMs() != null}> · sbs {fmtMs(sbsMs()!)}</Show>
                </span>
              </Show>
              <Show when={sourceImg()}>
                <span class="opacity-40 ml-auto tabular-nums">
                  {sourceImg()?.naturalWidth} × {sourceImg()?.naturalHeight}
                </span>
              </Show>
              <Show when={mediaKind() === "video" && videoMeta()}>
                <span class="opacity-60">
                  {vStage() ?? "Video ready"} · {Math.round(videoMeta()!.duration)}s · {videoMeta()!.width}×{videoMeta()!.height}
                </span>
              </Show>
              <Show when={mediaKind() === "video" && vBusy()}>
                {Number.isFinite(vFrac()) ? (
                  <progress
                    class="progress progress-neutral w-full mt-1"
                    value={Math.round(vFrac()! * 100)}
                    max="100"
                  />
                ) : (
                  <progress class="progress progress-neutral w-full mt-1" max="100" />
                )}
              </Show>
              <Show when={busy()}>
                {Number.isFinite(progress()) ? (
                  <progress
                    class="progress progress-neutral w-full mt-1"
                    value={Math.round(progress()! * 100)}
                    max="100"
                  />
                ) : (
                  // No `value` prop at all: Solid assigns `node.value = undefined`
                  // (= NaN, throws) if the prop exists with `undefined`.
                  <progress class="progress progress-neutral w-full mt-1" max="100" />
                )}
              </Show>
            </div>

            <div class="p-5 flex flex-col gap-5">
              <Show when={mediaKind() === "video"}>
                <Show
                  when={videoMeta()}
                  fallback={
                    <div class="rounded-xl bg-base-200/50 min-h-[360px] flex flex-col items-center justify-center gap-3 text-center p-8">
                      <div class="opacity-30">
                        <Film size={28} />
                      </div>
                      <p class="font-medium text-sm">No video yet</p>
                      <p class="text-sm opacity-50 max-w-xs">
                        Drop an MP4 / MKV / WebM — frames are sampled, depth-warped,
                        and encoded to SBS {container().toUpperCase()} ({codec()}).
                      </p>
                    </div>
                  }
                >
                  <div class="grid gap-5 md:grid-cols-2">
                    <div>
                      <p class="text-[11px] font-medium uppercase tracking-widest opacity-45 mb-2">
                        Input video
                      </p>
                      <video
                        src={videoUrl()}
                        controls
                        muted
                        playsinline
                        class="rounded-xl w-full max-h-[360px] bg-base-200/60 border border-base-content/10"
                      />
                      <p class="text-[11px] opacity-50 mt-1">{videoName()}</p>
                    </div>
                    <div>
                      <p class="text-[11px] font-medium uppercase tracking-widest opacity-45 mb-2">
                        3D SBS preview (first frame)
                      </p>
                      <canvas
                        ref={sbsCanvasRef}
                        class="sbs-canvas rounded-xl w-full max-h-[360px] object-contain bg-base-200/60 border border-base-content/10"
                      />
                    </div>
                  </div>
                  <Show when={videoOutUrl()}>
                    <div>
                      <p class="text-[11px] font-medium uppercase tracking-widest opacity-45 mb-2">
                        3D SBS output · {container().toUpperCase()} {codec()}
                      </p>
                      <video
                        src={videoOutUrl()!}
                        controls
                        playsinline
                        class="rounded-xl w-full max-h-[400px] bg-black border border-base-content/10"
                      />
                      <div class="mt-3">
                        <a class="btn btn-primary btn-sm" href={videoOutUrl()!} download={`${videoName().replace(/\.[a-z0-9]+$/i, "") || "video"}.sbs-${format()}.${container()}`}>
                          <Download size={14} /> Download {container().toUpperCase()}
                        </a>
                      </div>
                    </div>
                  </Show>
                </Show>
              </Show>
              <Show
                when={mediaKind() === "image" && sourceImg()}
                fallback={
                  <div class="rounded-xl bg-base-200/50 min-h-[360px] flex flex-col items-center justify-center gap-3 text-center p-8">
                    <div class="opacity-30">
                      <ImageIcon size={28} />
                    </div>
                    <p class="font-medium text-sm">No image yet</p>
                    <p class="text-sm opacity-50 max-w-xs">
                      Upload a photo or try the sample — input, depth output, and
                      SBS appear here.
                    </p>
                  </div>
                }
              >
                {/* Input vs model output */}
                <div class="grid gap-5 md:grid-cols-2">
                  <div>
                    <p class="text-[11px] font-medium uppercase tracking-widest opacity-45 mb-2">
                      Input
                    </p>
                    <img
                      src={sourceUrl()}
                      alt="Input 2D"
                      class="rounded-xl w-full max-h-[360px] object-contain bg-base-200/60 border border-base-content/10"
                    />
                  </div>
                  <div>
                    <p class="text-[11px] font-medium uppercase tracking-widest opacity-45 mb-2">
                      Depth map
                    </p>
                    <Show
                      when={depth()}
                      fallback={
                        <div class="rounded-xl border border-dashed border-base-content/20 min-h-[220px] h-full flex flex-col items-center justify-center gap-2 p-8 text-center">
                          <div class={`opacity-30 ${busy() ? "animate-pulse" : ""}`}>
                            <Brain size={22} />
                          </div>
                          <p class="text-sm opacity-60">
                            {busy() ? statusLabel() : "Run Convert to 3D to generate depth."}
                          </p>
                        </div>
                      }
                    >
                      <canvas
                        ref={depthCanvasRef}
                        class="rounded-xl w-full max-h-[360px] object-contain bg-base-200/60 border border-base-content/10"
                      />
                    </Show>
                  </div>
                </div>

                {/* SBS output */}
                <div>
                  <div class="flex items-baseline gap-3 mb-2">
                    <p class="text-[11px] font-medium uppercase tracking-widest opacity-45">
                      3D SBS
                    </p>
                    <Show when={status() === "done"}>
                      <span class="text-[11px] opacity-50">ready to export</span>
                    </Show>
                  </div>
                  <canvas
                    ref={sbsCanvasRef}
                    class="sbs-canvas rounded-xl w-full max-h-[400px] object-contain border border-base-content/10"
                  />
                  <div class="flex flex-wrap items-center gap-3 mt-3">
                    <button
                      class="btn btn-primary btn-sm"
                      onClick={handleDownload}
                      disabled={status() !== "done"}
                    >
                      <Download size={14} /> Download PNG
                    </button>
                    <span class="text-[11px] opacity-50">
                      {format() === "sbs-half" ? "Half-SBS · headsets & YouTube 3D" : "Full-SBS · max quality, double width"}
                    </span>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </section>

        {/* ── Roadmap strip ────────────────────────── */}
        <section class="grid sm:grid-cols-3 gap-3 mt-6">
          {[
            { t: "Images", d: "JPG / PNG / WebP → depth + SBS Half & Full, eye swap, strength.", on: true },
            { t: "Depth", d: "Depth Anything V2 Small on WebGPU, q4 quantized, WASM fallback.", on: true },
            { t: "Video", d: "MP4 / MKV in → SBS MP4 / MKV out, x264 or x265, 30 fps, silent.", on: true },
          ].map((c) => (
            <div class="rounded-2xl border border-base-content/10 p-4">
              <p class="text-[11px] font-medium uppercase tracking-widest opacity-45">
                {c.t} · {c.on ? "Live" : "Roadmap"}
              </p>
              <p class="text-[13px] opacity-70 mt-1.5 leading-relaxed">{c.d}</p>
            </div>
          ))}
        </section>

        <footer class="text-center text-[11px] opacity-40 mt-8">
          DepthSBS · SolidJS + daisyUI · depth: onnx-community/depth-anything-v2-small · no tracking, no uploads
        </footer>
      </main>
    </div>
  );
}
