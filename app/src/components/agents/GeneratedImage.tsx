import { memo, useState } from "react";
import type { ChatStep } from "../../model";
import { mediaUrl } from "../../lib/media";
import { ImageGeneration } from "./ImageGeneration";
import { StepRow } from "./StepRow";
import type { ImageGenerationStatus } from "./ImageGeneration";

/**
 * An image the agent generated, from its image step. Codex reports no progress between start and
 * finish, so the surface stays in "generating" until the saved file has loaded. A generation that
 * failed has no image to hold a place for, so it is a failed step row like any other.
 */
export const GeneratedImage = memo(function GeneratedImage({ step }: { step: ChatStep }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const src = step.file && !broken ? mediaUrl(step.file) : null;
  if (step.status === "failed" || (step.status === "done" && !src)) return <StepRow step={step.status === "failed" ? step : { ...step, status: "failed", title: "Couldn't show the generated image" }} />;
  const status: ImageGenerationStatus = step.status === "done" && size ? "complete" : "generating";
  return (
    <div data-slot="generated-image" className="my-2">
      <ImageGeneration
        size="fluid"
        className="max-w-80"
        status={status}
        // The dither field already says it is working and the image says it is ready; only the prompt is shown under it.
        showStatus={false}
        prompt={step.detail}
        resolution={size ? `${size.width} × ${size.height}` : ""}
        aspectRatio={size ? `${size.width} / ${size.height}` : "1 / 1"}
      >
        {src ? <img src={src} alt={step.detail ?? "Generated image"} draggable={false} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setBroken(true)} /> : null}
      </ImageGeneration>
    </div>
  );
});
