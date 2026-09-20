# DepthSBS — 2D → 3D image converter (browser-only)

SolidJS + Vite + Tailwind v4 + daisyUI. Converts 2D images to side-by-side (SBS)
3D for VR headsets & 3D TVs. 100% client-side — no uploads, no server.

## Quickstart

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # typecheck + production build → dist/
```

## Current state (image beta)

- Upload JPG/PNG/WebP via dropzone or file picker, or "Try a sample photo"
- Tune **3D strength**, **SBS Half / Full**, **swap eyes**
- **Convert to 3D** → L|R preview on canvas → **Export PNG**
- WebGPU availability badge (Chrome/Edge 113+ recommended)

## Depth: live via WebGPU

Model: [`onnx-community/depth-anything-v2-small`](https://huggingface.co/onnx-community/depth-anything-v2-small)
(Depth Anything V2 Small, ONNX) through `@huggingface/transformers`
`pipeline("depth-estimation", …)` — WebGPU first, WASM fallback.

> `depth-anything/DA3-SMALL` itself is PyTorch-only (safetensors + custom
> `depth-anything-3` code, no ONNX) so it can't run in-browser. V2-Small ONNX
> is the same model family, officially exported for transformers.js.

Wiring points (see `src/lib/`):

- `src/lib/models.ts` — model list (q4 fast / fp32 quality) + WebGPU probe
- `src/lib/depth.ts` — lazy-loaded singleton loader + `estimateDepth()` (min-max norm; DA V2: larger = farther)
- `src/lib/sbs.ts` — `renderSbsFromDepth(source, depthNorm, opts)`; per-pixel shift `(1 − norm) × baseline / 2`, edges clamped (no inpainting yet)
- `src/lib/types.ts` — `SbsOptions`, `OutputFormat`, `PipelineStatus`

`vite.config.ts` sets COOP/COEP headers for model workers, excludes
transformers from prebundling, and code-splits the depth chunk (loads on
first Convert, not first paint).

## Roadmap

- [x] Image 2D → depth + SBS (DA V2 Small, WebGPU)
- [ ] Anaglyph + depth colormap views
- [ ] Video → 3D SBS

## Stack

- [SolidJS](https://solidjs.com) + [Vite](https://vite.dev)
- [Tailwind CSS v4](https://tailwindcss.com) + [daisyUI](https://daisyui.com) (`abyss` theme)
- [lucide-solid](https://lucide.dev) icons
- Bun as runtime & package manager
