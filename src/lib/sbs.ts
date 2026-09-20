import type { SbsOptions } from "./types";

/**
 * SBS renderer — depth-warped stereo from a monocular depth map.
 *
 * Geometry: parallel cameras → an object at depth Z shifts by s ∝ 1/Z.
 * DA V2 norm is 0 = near … 1 = far, so per-pixel shift s = (1 - norm) * baseline / 2,
 * left eye samples x + s, right eye x - s (swapped when swapEyes).
 */

function drawEyeLabels(ctx: CanvasRenderingContext2D, eyeW: number, h: number, leftFirst: boolean) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(eyeW - 1, 0, 2, h);
  ctx.font = `${Math.max(12, Math.round(h * 0.03))}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(leftFirst ? "L" : "R", 10, 22);
  ctx.fillText(leftFirst ? "R" : "L", eyeW + 10, 22);
  ctx.restore();
}

/** Paint a grayscale depth map onto a canvas (sized to w×h). */
export function drawDepthMap(
  gray: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  canvas: HTMLCanvasElement,
) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = gray[i];
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Warp source pixels into L|R stereo views and compose per `format`.
 * ponytail: naive per-pixel horizontal warp, edges clamped (holes stretch
 * instead of inpainting). Upgrade to depth-aware fill when artifacts matter.
 */
export function renderSbsFromDepth(
  source: ImageData,
  depthNorm: Float32Array,
  opts: SbsOptions,
  canvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  if (depthNorm.length !== w * h) throw new Error("Depth map size mismatch.");

  const half = opts.format === "sbs-half";
  canvas.width = half ? w : w * 2;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");

  const halfShift = (opts.baseline / 2) | 0;
  const eyes: ImageData[] = [ctx.createImageData(w, h), ctx.createImageData(w, h)];

  for (let e = 0; e < 2; e++) {
    // e=0 → left view (samples x + s), e=1 → right view (x - s); swap flips.
    const dir = (e === 0) !== opts.swapEyes ? 1 : -1;
    const eye = eyes[e];
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const s = Math.round((1 - depthNorm[row + x]) * halfShift);
        const sx = x + dir * s;
        const cx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
        const si = (row + cx) * 4;
        const di = (row + x) * 4;
        eye.data[di] = source.data[si];
        eye.data[di + 1] = source.data[si + 1];
        eye.data[di + 2] = source.data[si + 2];
        eye.data[di + 3] = 255;
      }
    }
  }

  // Compose via temp canvases so half-SBS can downscale each eye.
  const eyeW = half ? w / 2 : w;
  for (let e = 0; e < 2; e++) {
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d")!.putImageData(eyes[e], 0, 0);
    ctx.drawImage(tmp, e * eyeW, 0, eyeW, h);
  }
  drawEyeLabels(ctx, eyeW, h, !opts.swapEyes);
  return canvas;
}

/**
 * PNG blob of a canvas. Rejects (instead of throwing sync) so callers can
 * surface export failures in UI. Blob + object URL — unlike toDataURL this
 * doesn't build a multi-MB string, which silently fails on large canvases.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas is empty or unavailable"));
    }, "image/png");
  });
}

/** Load a File/Blob into an HTMLImageElement (object URL, CORS-safe). */
export function loadFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode that image. Try a JPG/PNG/WebP."));
    };
    img.src = url;
  });
}

/** Load a remote sample (must serve CORS headers, picsum does). */
export function loadUrlAsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load sample image."));
    img.src = url;
  });
}

/** Draw an image to an offscreen canvas at native res — single pixel source. */
export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}
