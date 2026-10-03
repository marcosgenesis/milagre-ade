import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { resolveCodeLanguage } from "../../lib/code-languages";
import { diffRows } from "../../lib/message-fences";
import { highlight, isLanguageReady, loadLanguage } from "./highlighter";

const ROW_TINT = { add: "bg-[var(--diff-add)]", remove: "bg-[var(--diff-remove)]", context: "" } as const;
const ROW_MARKER = { add: "+", remove: "−", context: " " } as const;
const MARKER_COLOR = { add: "text-green", remove: "text-red", context: "" } as const;

/**
 * A fenced block with its language's colours. With `diff`, a block whose lines all start with `+`, `-` or a space
 * (a diff snippet, as diff comments send) shows tinted rows and highlights the code without the markers.
 */
export function CodeBlock({ code, fence, diff = false }: { code: string; fence?: string; diff?: boolean }) {
  const rows = useMemo(() => (diff ? diffRows(code) : null), [code, diff]);
  const source = rows ? rows.map((row) => row.text).join("\n") : code;
  const language = resolveCodeLanguage(fence);
  const [, setLoadedCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const languageReady = language !== undefined && isLanguageReady(language);

  useEffect(() => {
    if (!language || languageReady) return;
    let live = true;
    loadLanguage(language).then(() => { if (live) setLoadedCount((count) => count + 1); }, () => {});
    return () => { live = false; };
  }, [language, languageReady]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const lines = useMemo(() => (language && languageReady ? highlight(source, language) : undefined), [source, language, languageReady]);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  return (
    <div className="markdown-code my-2 overflow-hidden rounded-control border border-line bg-inset">
      <div className="flex h-7 items-center justify-between border-b border-line pr-1 pl-2.5 text-[11px] text-ink-3">
        <span className="font-mono">{fence?.toLowerCase() || "text"}</span>
        <button type="button" aria-label={copied ? "Copied" : "Copy code"} onClick={copy} className="flex size-6 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={13} strokeWidth={1.8} color="currentColor" />
        </button>
      </div>
      {rows ? (
        <pre className="overflow-x-auto py-1.5 font-mono text-[12px] leading-[1.6]">
          <code className="block min-w-max">
            {rows.map((row, index) => (
              <span key={index} className={`flex pr-3 ${ROW_TINT[row.kind]}`}>
                <span aria-hidden className={`w-6 shrink-0 select-none text-center ${MARKER_COLOR[row.kind]}`}>{ROW_MARKER[row.kind]}</span>
                <span className="whitespace-pre">
                  {lines?.[index]
                    ? lines[index].map((token, tokenIndex) => <span key={tokenIndex} className="code-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>)
                    : row.text || "\u200b"}
                </span>
                {index < rows.length - 1 && "\n"}
              </span>
            ))}
          </code>
        </pre>
      ) : (
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.6]">
        <code>
          {/* Lines stay joined by real newlines so a hand selection copies blank lines too. */}
          {lines
            ? lines.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && "\n"}
                  {line.map((token, tokenIndex) => <span key={tokenIndex} className="code-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>)}
                </Fragment>
              ))
            : code}
        </code>
      </pre>
      )}
    </div>
  );
}
