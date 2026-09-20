import type { DepthModelInfo } from "./types";

/** Browser-runnable picks. NOTE: `depth-anything/DA3-SMALL` is PyTorch-only
 * (no ONNX) so it can't run in-browser; V2-Small ONNX is the same family,
 * officially exported for transformers.js. */

export const DEPTH_MODEL_REPO = "onnx-community/depth-anything-v2-small";

export const DEPTH_MODELS: DepthModelInfo[] = [
  {
    id: "v2-small-q4",
    label: "DA V2 Small · fast",
    repo: DEPTH_MODEL_REPO,
    dtype: "q4",
    size: "~30 MB",
    notes: "Quantized — best for WebGPU.",
  },
  {
    id: "v2-small-fp32",
    label: "DA V2 Small · quality",
    repo: DEPTH_MODEL_REPO,
    dtype: "fp32",
    size: "~100 MB",
    notes: "Full precision — slower, sharper depth.",
  },
];

/** True when `navigator.gpu` can hand out an adapter. No model involved. */
export async function checkWebGpuSupport(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) return false;
    return !!(await nav.gpu.requestAdapter());
  } catch {
    return false;
  }
}
