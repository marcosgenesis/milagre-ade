import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { GENUI_ROOT, genuiDefinitions } from "@milagre/shared/genui";
import { renderers } from "./components";

/** The contract bound to the desktop renderers; what `Renderer` draws a block with. */
export const genuiLibrary = createLibrary({
  root: GENUI_ROOT,
  components: genuiDefinitions<unknown>(renderers).map((definition) => defineComponent(definition as unknown as Parameters<typeof defineComponent>[0])),
});
