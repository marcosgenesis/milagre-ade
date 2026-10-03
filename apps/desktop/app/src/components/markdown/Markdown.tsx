import { Children, isValidElement, memo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { codeLanguageFromClassName } from "../../lib/code-languages";
import { fileLinkTarget } from "../../lib/file-links";
import { useFileOpener } from "../editor-links";
import { closeOpenMarkdown } from "../../lib/streaming-markdown";
import { CodeBlock } from "./CodeBlock";
import { splitStreamingBlocks } from "./streaming-blocks";

const CODE_CLASS = "rounded-[4px] bg-field px-1 py-px font-mono text-[0.92em] text-ink";

// Inline code that names a file of the chat's folder opens it in the editor; the click asks main, which says
// when the file isn't there. Everything else stays plain code.
function InlineCode({ children }: { children?: ReactNode }) {
  const opener = useFileOpener();
  const text = Children.toArray(children).join("");
  const target = opener ? fileLinkTarget(text) : null;
  if (!opener || !target) return <code className={CODE_CLASS}>{children}</code>;
  return (
    <button type="button" title={opener.title} onClick={() => opener.open(target.path, target.line)} className={`${CODE_CLASS} cursor-pointer text-left decoration-ink-3 underline-offset-2 hover:underline`}>
      {children}
    </button>
  );
}

// Raw HTML in a reply is shown as text (react-markdown's default), and unsafe link protocols are dropped.
const components: Components = {
  pre({ children }) {
    const code = Children.toArray(children).find(isValidElement) as { props: { className?: string; children?: ReactNode } } | undefined;
    const text = String(code?.props.children ?? "").replace(/\n$/, "");
    return <CodeBlock code={text} fence={codeLanguageFromClassName(code?.props.className)} />;
  },
  code: InlineCode,
  a({ href, children }) {
    return <a href={href} title={href} target="_blank" rel="noreferrer" className="text-accent-ink underline decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink">{children}</a>;
  },
  // Remote images in a reply would load without asking; show them as links instead.
  img({ src, alt }) {
    const href = typeof src === "string" ? src : undefined;
    return <a href={href} title={href} target="_blank" rel="noreferrer" className="text-accent-ink underline decoration-accent-ink/40 underline-offset-2">{alt || href || "image"}</a>;
  },
  table({ children }) {
    return <div className="my-2 overflow-x-auto"><table>{children}</table></div>;
  },
};

// Parsed output of one block of text; memoized so a block that stopped changing never parses again.
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>;
});

const WRAPPER = "markdown break-words [overflow-wrap:anywhere]";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={WRAPPER}>
      <MarkdownBody text={text} />
    </div>
  );
});

/**
 * The answer of a running turn. Its finished blocks render from memo, and only the block being written is
 * parsed (with its open bold or code span closed), so a long answer costs no more per batch than a short one.
 * One wrapper keeps the spacing between blocks the same as when the whole text is a single `Markdown`.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text }: { text: string }) {
  const blocks = splitStreamingBlocks(text);
  return (
    <div className={WRAPPER}>
      {blocks.map((block, index) => index === blocks.length - 1
        ? <MarkdownBody key={index} text={closeOpenMarkdown(block)} />
        : <MarkdownBody key={index} text={block} />)}
    </div>
  );
});
