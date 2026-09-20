import { createSignal, type JSX } from "solid-js";
import { ImagePlus, Loader2 } from "lucide-solid";

interface Props {
  onFile: (f: File) => void;
  onSample: () => void;
  loadingSample: boolean;
  hasImage: boolean;
}

export default function Dropzone(props: Props) {
  const [dragOver, setDragOver] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const handleDrop: JSX.EventHandlerUnion<HTMLDivElement, DragEvent> = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith("image/")) props.onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef?.click()}
      class={`cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-6 text-center select-none ${
        dragOver()
          ? "border-primary bg-primary/10 scale-[1.01]"
          : "border-base-content/20 bg-base-200/40 hover:border-primary/60 hover:bg-base-200/70"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) props.onFile(f);
          e.currentTarget.value = "";
        }}
      />
      <div class="flex flex-col items-center gap-3">
        <div class="bg-primary/15 text-primary rounded-2xl p-3.5">
          <ImagePlus size={28} />
        </div>
        <div>
          <p class="font-semibold">
            {props.hasImage ? "Drop a new image to replace" : "Drop your 2D image here"}
          </p>
          <p class="text-sm opacity-60 mt-1">
            or <span class="link link-primary">click to browse</span> · JPG / PNG / WebP · stays on-device
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            props.onSample();
          }}
          disabled={props.loadingSample}
        >
          {props.loadingSample ? (
            <>
              <Loader2 size={14} class="animate-spin" /> Loading sample…
            </>
          ) : (
            "✨ Try a sample photo"
          )}
        </button>
      </div>
    </div>
  );
}
