import { Component, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent, ParseResult } from "@openuidev/react-lang";
import { GENUI_ACTION_TYPE, genuiLimits } from "@milagre/shared/genui";
import { genuiLibrary } from "./library";

type Send = (text: string) => Promise<boolean | "busy">;
const SendContext = createContext<{ send?: Send }>({});

/** Gives every block in the transcript the screen's send function, so a button can post its message. */
export function GenerativeUIProvider({ send, children }: { send?: Send; children: ReactNode }) {
  const value = useMemo(() => ({ send }), [send]);
  return <SendContext value={value}>{children}</SendContext>;
}

/** Whether the surrounding markdown is the chunk of a reply still being written. */
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

/** An `openui` fence rendered from the contract; `fallback` is the plain fence view, shown when the block can't render. */
export function GenerativeUI({ code, fallback }: { code: string; fallback: ReactNode }) {
  const streaming = useContext(MarkdownStreamingContext);
  const { send } = useContext(SendContext);
  const [rootless, setRootless] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const onParseResult = useCallback((result: ParseResult | null) => setRootless(!result?.root), []);
  const onAction = useCallback(
    async (event: ActionEvent) => {
      if (event.type !== GENUI_ACTION_TYPE || !send || sending.current || !event.humanFriendlyMessage) return;
      sending.current = true;
      setBusy(true);
      try {
        await send(event.humanFriendlyMessage);
      } catch {
        // The Chat send path presents failures; allow the button to retry.
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [send],
  );
  if (code.length > genuiLimits.text) return <>{fallback}</>;
  if (rootless && !streaming) return <>{fallback}</>;
  return (
    <Boundary fallback={fallback}>
      <View pointerEvents={busy ? "none" : "auto"} style={{ opacity: busy ? 0.6 : 1 }}>
        <Renderer response={code} library={genuiLibrary} isStreaming={streaming || busy || !send} onParseResult={onParseResult} onAction={onAction} />
      </View>
    </Boundary>
  );
}
