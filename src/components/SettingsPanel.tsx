import { For } from "solid-js";
import { Cpu, SlidersHorizontal } from "lucide-solid";
import { DEPTH_MODELS } from "../lib/models";
import type { OutputFormat } from "../lib/types";

interface Props {
  baseline: number;
  setBaseline: (v: number) => void;
  swapEyes: boolean;
  setSwapEyes: (v: boolean) => void;
  format: OutputFormat;
  setFormat: (v: OutputFormat) => void;
  modelId: string;
  setModelId: (v: string) => void;
  webGpu: boolean | null;
}

export default function SettingsPanel(props: Props) {
  return (
    <div class="card bg-base-200/60 border border-base-content/10 rounded-2xl">
      <div class="card-body p-5 gap-5">
        <h3 class="flex items-center gap-2 font-semibold text-sm uppercase tracking-wider opacity-70">
          <SlidersHorizontal size={15} /> Convert settings
        </h3>

        {/* Stereo strength */}
        <div>
          <div class="flex justify-between text-sm mb-1.5">
            <span class="font-medium">3D strength</span>
            <span class="badge badge-primary badge-sm">{props.baseline}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            value={props.baseline}
            onInput={(e) => props.setBaseline(Number(e.currentTarget.value))}
            class="range range-primary range-sm w-full"
          />
          <div class="flex justify-between text-[11px] opacity-50 mt-1">
            <span>Flat</span>
            <span>Subtle</span>
            <span>Deep</span>
          </div>
          <p class="text-[11px] opacity-50 mt-1.5">
            Live — re-warps the stereo pair from the cached depth map.
          </p>
        </div>

        {/* Format */}
        <div>
          <label class="text-sm font-medium block mb-1.5">Output format</label>
          <div class="join w-full">
            <button
              class={`btn btn-sm join-item flex-1 ${props.format === "sbs-half" ? "btn-primary" : "btn-ghost border border-base-content/10"}`}
              onClick={() => props.setFormat("sbs-half")}
            >
              SBS Half
            </button>
            <button
              class={`btn btn-sm join-item flex-1 ${props.format === "sbs-full" ? "btn-primary" : "btn-ghost border border-base-content/10"}`}
              onClick={() => props.setFormat("sbs-full")}
            >
              SBS Full
            </button>
          </div>
          <div class="flex gap-1.5 mt-2">
            <span class="badge badge-sm badge-ghost opacity-60">Anaglyph · soon</span>
            <span class="badge badge-sm badge-ghost opacity-60">Video · soon</span>
          </div>
        </div>

        {/* Eyes */}
        <label class="flex items-center justify-between cursor-pointer text-sm">
          <span class="font-medium">Swap eyes (cross-eyed)</span>
          <input
            type="checkbox"
            class="toggle toggle-primary toggle-sm"
            checked={props.swapEyes}
            onChange={(e) => props.setSwapEyes(e.currentTarget.checked)}
          />
        </label>

        <div class="divider my-0" />

        {/* Model */}
        <div>
          <label class="text-sm font-medium flex items-center gap-1.5 mb-1.5">
            <Cpu size={14} /> Depth model
            <span class="badge badge-ghost badge-xs">on-device</span>
          </label>
          <select
            class="select select-bordered select-sm w-full"
            value={props.modelId}
            onChange={(e) => props.setModelId(e.currentTarget.value)}
            title="Changing model re-downloads on next Convert"
          >
            <For each={DEPTH_MODELS}>
              {(m) => <option value={m.id}>{m.label} — {m.size}</option>}
            </For>
          </select>
          <div class="mt-2 flex items-center gap-2 text-xs">
            {props.webGpu === null ? (
              <span class="badge badge-ghost badge-sm">checking WebGPU…</span>
            ) : props.webGpu ? (
              <span class="badge badge-success badge-sm">✓ WebGPU ready</span>
            ) : (
              <span class="badge badge-error badge-sm">✕ WebGPU unavailable</span>
            )}
            <span class="opacity-50">Chrome / Edge 113+ recommended</span>
          </div>
        </div>
      </div>
    </div>
  );
}
