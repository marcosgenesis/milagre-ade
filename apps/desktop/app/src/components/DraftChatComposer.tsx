import type { ComponentProps } from "react";
import { useDraft, type DraftStore } from "../lib/draft-store";
import { ChatComposer } from "./ChatComposer";

/** ChatComposer with its draft read from a store, so a keystroke re-renders this and not the App that owns the store. */
export function DraftChatComposer({ store, ...props }: Omit<ComponentProps<typeof ChatComposer>, "draft" | "onDraftChange"> & { store: DraftStore }) {
  const draft = useDraft(store);
  return <ChatComposer {...props} draft={draft} onDraftChange={store.set} />;
}
