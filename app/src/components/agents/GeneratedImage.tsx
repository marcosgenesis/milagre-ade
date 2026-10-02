import { memo, useState } from "react";
import type { ChatStep } from "../../model";
import { mediaUrl } from "../../lib/media";
import { ImageGeneration } from "./ImageGeneration";
import type { ImageGenerationStatus } from "./ImageGeneration";

/**
 * An image the agent generated, from its image step. Codex reports no progress between start and
 * finish, so the surface stays in "generating" until the saved file has loaded.
 */
export const GeneratedImage = memo(function GeneratedImage({ step }: { step: ChatStep }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const src = step.file && !broken ? mediaUrl(step.file) : null;
  const status: ImageGenerationStatus = step.status === "failed" || (step.status === "done" && !src) ? "error" : step.status === "done" && size ? "complete" : "generating";
  return (
    <div data-slot="generated-image" className="my-2">
      <ImageGeneration
        size="fluid"
        className="max-w-80"
        status={status}
        statusText={status === "error" ? (step.note ? `Couldn't generate the image: ${step.note}` : "Couldn't generate the image") : undefined}
        prompt={step.detail}
        resolution={size && status !== "error" ? `${size.width} × ${size.height}` : ""}
        aspectRatio={size ? `${size.width} / ${size.height}` : "1 / 1"}
      >
        {src ? <img src={src} alt={step.detail ?? "Generated image"} draggable={false} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setBroken(true)} /> : null}
      </ImageGeneration>
    </div>
  );
});
