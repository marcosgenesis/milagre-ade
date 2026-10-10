import { Component, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Renderer } from "@milagre/shared/genui-renderer";
import type { ActionEvent, ParseResult } from "@milagre/shared/genui-renderer";
import { GENUI_ACTION_TYPE, genuiTextOverLimit } from "@milagre/shared/genui";
import { genuiLibrary } from "./library";

type Send = (text: string) => Promise<boolean>;
const SendContext = createContext<{ onSend?: Send }>({});

/** Gives every block in the transcript the chat's send function, so a button can post its message. */
export function GenerativeUIProvider({ onSend, children }: { onSend?: Send; children: ReactNode }) {
  const value = useMemo(() => ({ onSend }), [onSend]);
  return <SendContext value={value}>{children}</SendContext>;
}

/** Whether the surrounding markdown is the block of a reply still being written. */
export const MarkdownStreamingContext = createContext(false);

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * An `openui` fence rendered from the component contract. `fallback` is the plain code block, shown when the text is
 * over the cap, parses to no root once the reply has finished, or a renderer throws.
 */
export function GenerativeUI({ code, fallback }: { code: string; fallback: ReactNode }) {
  const streaming = useContext(MarkdownStreamingContext);
  const { onSend } = useContext(SendContext);
  const [rootless, setRootless] = useState(false);
  const [busy, setBusy] = useState(false);
  // A second tap while the first send is in flight must not send again; state alone is stale within the same tick.
  const sending = useRef(false);
  const onParseResult = useCallback((result: ParseResult | null) => setRootless(!result?.root || !!result.meta.incomplete), []);
  const onAction = useCallback(
    async (event: ActionEvent) => {
      if (event.type !== GENUI_ACTION_TYPE || !onSend || sending.current || !event.humanFriendlyMessage) return;
      sending.current = true;
      setBusy(true);
      try {
        await onSend(event.humanFriendlyMessage);
      } catch {
        // A failed send leaves the button as it was; the chat shows the error where it sends from.
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [onSend],
  );
  if (genuiTextOverLimit(code)) return <>{fallback}</>;
  const empty = rootless && !streaming;
  return (
    <Boundary fallback={fallback}>
      {empty && fallback}
      {/* Hidden, it is no block: the slot is what a check (or a find) counts as UI in the reply. */}
      <div data-slot={empty ? undefined : "genui"} hidden={empty} className="my-2">
        <Renderer response={code} library={genuiLibrary} isStreaming={streaming || busy || !onSend} onParseResult={onParseResult} onAction={onAction} />
      </div>
    </Boundary>
  );
}
