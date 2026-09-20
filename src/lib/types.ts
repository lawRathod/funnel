/** Shared domain types. Internals (depth warp, video) come later. */

export type OutputFormat =
  | "sbs-half" // side-by-side, each eye squished to half width (VR / 3D TV friendly)
  | "sbs-full" // side-by-side full width per eye
  | "anaglyph" // FUTURE
  | "depth-map"; // FUTURE — debug view

export type PipelineStatus =
  | "idle"
  | "loading-model"
  | "estimating-depth"
  | "rendering"
  | "done"
  | "error";

export interface SbsOptions {
  /** Stereo strength in px at full-res depth range. UI slider 0–60. */
  baseline: number;
  /** Swap L/R (cross-eyed vs parallel). */
  swapEyes: boolean;
  format: OutputFormat;
}

export interface DepthModelInfo {
  id: string;
  label: string;
  repo: string;
  /** transformers.js dtype → which onnx file to fetch */
  dtype: "q4" | "fp32";
  /** approx download size for UI display */
  size: string;
  notes: string;
}
