import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isMarkdownFile } from "@milagre/shared/file-link";
import { FileCode } from "./FileCode";
import { FilesRoot } from "./editor-links";
import { Markdown } from "./markdown/Markdown";
import { ScrollArea } from "./primitives/ScrollArea";
import { useBridge } from "../lib/computer-bridge";

export function AttachmentPreview({ path, name, file, close }: { file?: File; path: string; name: string; close: () => void }) {
  const bridge = useBridge();
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<{ text: string; binary: boolean; truncated: boolean } | null>(null);
  const [error, setError] = useState("");
  const markdown = isMarkdownFile(name);
  const [formatted, setFormatted] = useState(true);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let current = true;
    const read = file
      ? file
          .slice(0, 256 * 1024)
          .arrayBuffer()
          .then((buffer) => {
            const bytes = new Uint8Array(buffer);
            if (bytes.includes(0)) return { text: "", binary: true, truncated: false };
            try {
              return {
                text: new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: file.size > bytes.length }),
                binary: false,
                truncated: file.size > bytes.length,
              };
            } catch {
              return { text: "", binary: true, truncated: false };
            }
          })
      : bridge.readAttachment(path);
    read.then(
      (value) => {
        if (current) setResult(value);
      },
      (reason) => {
        if (current) setError(reason.message || "Could not read this file.");
      },
    );
    return () => {
      current = false;
    };
  }, [path, file, bridge]);
  return createPortal(
    <dialog
      ref={dialog}
      aria-label={`Preview ${name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 m-auto max-h-[80vh] w-[min(90vw,900px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/30 backdrop:backdrop-blur-overlay"
    >
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>
            {name}
          </h2>
          {markdown && result?.text && (
            <div role="group" aria-label="Markdown view" className="flex rounded-control bg-field p-0.5 text-xs">
              {[
                { label: "Formatted", value: true },
                { label: "Source", value: false },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={formatted === option.value}
                  onClick={() => setFormatted(option.value)}
                  className={`rounded-[5px] px-2 py-0.5 focus-visible:outline-accent-ink ${formatted === option.value ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label="Close file preview"
            onClick={close}
            className="rounded-control px-2 py-1 text-sm hover:bg-hover focus-visible:outline-accent-ink"
          >
            Close
          </button>
        </header>
        <ScrollArea className="min-h-0 flex-1 p-4">
          {error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : !result ? (
            <p role="status" className="text-sm text-ink-2">
              Reading file…
            </p>
          ) : result.binary ? (
            <p className="text-sm text-ink-2">This file does not have a text preview.</p>
          ) : result.text && markdown && formatted ? (
            <FilesRoot root={path.slice(0, path.lastIndexOf("/")) || "/"}>
              <div className="text-[13px] leading-[1.55]">
                <Markdown text={result.text} />
              </div>
            </FilesRoot>
          ) : result.text ? (
            <FileCode text={result.text} name={name} />
          ) : (
            <p className="text-sm text-ink-2">This file is empty.</p>
          )}
          {result?.truncated && (
            <p role="status" className="mt-4 text-xs text-ink-2">
              Showing the first 256 KB.
            </p>
          )}
        </ScrollArea>
      </div>
    </dialog>,
    document.body,
  );
}
