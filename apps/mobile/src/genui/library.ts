import { createLibrary, defineComponent } from "@milagre/shared/genui-renderer";
import { GENUI_ROOT, genuiDefinitions } from "@milagre/shared/genui";
import { renderers } from "./components";

/** The contract bound to the phone's renderers. */
export const genuiLibrary = createLibrary({
  root: GENUI_ROOT,
  components: genuiDefinitions<unknown>(renderers).map((definition) => defineComponent(definition as unknown as Parameters<typeof defineComponent>[0])),
});
