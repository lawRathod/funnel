// NOTE: statically imported by NOBODY at startup — App lazy-loads this
// module on first Convert so transformers.js + onnxruntime stay out of the
// initial bundle. Model list + WebGPU probe live in ./models.ts.
import { pipeline } from "@huggingface/transformers";
import type { DepthModelInfo } from "./types";

export interface DepthResult {
  width: number;
  height: number;
  /** Grayscale depth 0..255 at source resolution (for display). */
  gray: Uint8ClampedArray | Uint8Array;
  /**
   * Normalized 0..1 from the same map. DA V2 predicts larger = FARTHER,
   * so norm 1 = far, 0 = near. SBS warp uses disparity = (1 - norm).
   */
  norm: Float32Array;
}

type ProgressFn = (frac: number) => void;

// Minimal structural typing for the depth-estimation pipeline output —
// avoids coupling to transformers.js internal TS types.
interface DepthEstimator {
  (
    image: HTMLImageElement | HTMLCanvasElement | string,
  ): Promise<{
    depth: { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
  }>;
}

const estimatorCache = new Map<string, Promise<DepthEstimator>>();

/** Singleton loader (model downloads once, then inference is offline). */
export function getDepthEstimator(
  model: DepthModelInfo,
  device: "webgpu" | "wasm",
  onProgress?: ProgressFn,
): Promise<DepthEstimator> {
  const key = `${model.repo}::${model.dtype}::${device}`;
  let pending = estimatorCache.get(key);
  if (!pending) {
    pending = pipeline("depth-estimation", model.repo, {
      device,
      dtype: model.dtype,
      progress_callback: (info: { status: string; progress?: number }) => {
        // Library emits byte-weighted `progress_total` (0–100) across files.
        // `total` can be unknown → NaN, which <progress> rejects, so only forward finite values.
        if (onProgress && info.status === "progress_total" && Number.isFinite(info.progress)) {
          onProgress(Math.min(1, Math.max(0, info.progress! / 100)));
        }
      },
    }) as Promise<DepthEstimator>;
    // Don't cache rejections — a retry should try the network again.
    pending.catch(() => estimatorCache.delete(key));
    estimatorCache.set(key, pending);
  }
  return pending;
}

/** Run depth estimation on a full-res source canvas. Throws on failure. */
export async function estimateDepth(
  estimator: DepthEstimator,
  source: HTMLCanvasElement,
): Promise<DepthResult> {
  const out = await estimator(source);
  const { data, width, height } = out.depth;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const norm = new Float32Array(data.length);
  const span = max - min;
  if (span > 0) {
    for (let i = 0; i < data.length; i++) norm[i] = (data[i] - min) / span;
  }
  return { width, height, gray: data, norm };
}
