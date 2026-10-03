import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { openInEditor, useEditors } from "../lib/editors";
import { useNotice } from "../lib/notice";

const RootContext = createContext<string | null>(null);

/** Names the folder (the chat's worktree or project) that file links in the replies below it resolve against. */
export function EditorLinks({ root, children }: { root: string; children: ReactNode }) {
  return <RootContext.Provider value={root}>{children}</RootContext.Provider>;
}

/** Opens a file of the chat's folder in the editor, or null when there is no folder or no editor to open it in. */
export function useFileOpener(): { open: (path: string, line?: number) => void; title: string } | null {
  const root = useContext(RootContext);
  const { editor } = useEditors();
  return useMemo(() => (root && editor ? { open: (path, line) => void openInEditor(root, { path, line }), title: `Open in ${editor.name}` } : null), [root, editor]);
}

/** The small notice at the bottom of the window. */
export function Notice() {
  const notice = useNotice();
  if (!notice) return null;
  return (
    <div role="status" key={notice.id} className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
      <div className="rounded-control bg-surface px-3 py-2 text-[12.5px] font-medium text-ink shadow-card">{notice.text}</div>
    </div>
  );
}
