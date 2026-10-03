import { useLayoutEffect, useRef, useState } from "react";

/** Animate a replacement, never the initial render or a remounted sidebar row. */
export function ChatTitle({ label }: { label: string }) {
  const previous = useRef(label);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (previous.current === label) return;
    setOutgoing(previous.current);
    previous.current = label;
    const timer = window.setTimeout(() => setOutgoing(null), 240);
    return () => window.clearTimeout(timer);
  }, [label]);
  return (
    <span className="chat-title" data-chat-title data-changing={outgoing !== null ? "true" : undefined}>
      <span className="sr-only">{label}</span>
      {outgoing !== null && <span key={`old-${label}`} className="chat-title-outgoing" aria-hidden>{outgoing}</span>}
      <span key={label} className="chat-title-current" aria-hidden>{label}</span>
    </span>
  );
}
