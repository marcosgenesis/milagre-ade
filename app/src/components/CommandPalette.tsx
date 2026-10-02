import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, BubbleChatIcon, CodeIcon, Copy01Icon, FolderOpenIcon, GitBranchIcon, Search01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { filterCommands, type Command } from "../lib/commands";
import { useShortcutHints } from "../lib/shortcut-hints";
import { useScrollFade } from "../lib/use-scroll-fade";

const icons = { add: Add01Icon, chat: BubbleChatIcon, folder: FolderOpenIcon, settings: Settings01Icon, git: GitBranchIcon, editor: CodeIcon, copy: Copy01Icon, unread: BubbleChatIcon };

export function CommandPalette({ commands, onClose, onError }: {
  commands: Command[];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const showHints = useShortcutHints();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const executing = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  useScrollFade(list);
  const listId = useId();
  const results = filterCommands(commands, query);
  const selected = results.find((command) => command.id === selectedId) ?? results[0];
  const selectedIndex = selected ? results.indexOf(selected) : -1;

  useLayoutEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected?.id, query]);

  function execute(command: Command) {
    if (executing.current) return;
    executing.current = true;
    onClose();
    // Let focus restore before the action opens a new surface.
    window.setTimeout(() => {
      Promise.resolve().then(command.run).catch((error: unknown) => onError(error instanceof Error ? error.message : "Couldn't run this command."));
    }, 0);
  }

  return createPortal(
    <dialog ref={dialog} aria-label="Command palette" className="command-palette fixed m-0 flex max-h-[min(560px,80vh)] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border border-line bg-surface p-0 text-ink shadow-overlay [-webkit-app-region:no-drag]"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        // Consume Escape before the app's stop-agent shortcut sees it.
        if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k")) {
          event.preventDefault(); event.stopPropagation(); onClose();
        } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
          const command = commands.find((item) => item.shortcut?.replace(/^(⌘|Ctrl\+)/, "").toLowerCase() === event.key.toLowerCase());
          if (command) { event.preventDefault(); execute(command); }
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (results.length) setSelectedId(results[(selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length].id);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (selected) execute(selected);
        } else if (event.key === "Tab") {
          event.preventDefault(); input.current?.focus();
        }
      }}>
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5">
        <HugeiconsIcon icon={Search01Icon} size={18} className="shrink-0 text-ink-3" />
        <input ref={input} role="combobox" aria-label="Search commands, chats, and projects" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined}
          value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} placeholder="Search commands, chats, and projects…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3" />
        {showHints && <kbd data-shortcut-hint className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">esc</kbd>}
      </div>
      <div ref={list} id={listId} role="listbox" aria-label="Commands" className="scroll-fade min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {Array.from(new Set(results.map((command) => command.group))).map((group) => (
          <div key={group} role="group" aria-label={group} className="pb-1.5">
            <div aria-hidden="true" className="px-2.5 pb-1.5 pt-2.5 text-[11px] font-medium text-ink-3">{group}</div>
            {results.filter((command) => command.group === group).map((command) => (
              <div key={command.id} id={`${listId}-${results.indexOf(command)}`} role="option" aria-selected={command.id === selected?.id}
                onPointerMove={() => setSelectedId(command.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => execute(command)}
                className={`flex cursor-default items-center gap-3 rounded-[6px] px-2.5 py-2 text-[13px] ${command.id === selected?.id ? "bg-hover-2" : ""}`}>
                <HugeiconsIcon icon={icons[command.icon]} size={17} strokeWidth={1.8} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.detail && <span className="max-w-[45%] truncate text-[11px] text-ink-3">{command.detail}</span>}
                {showHints && command.shortcut && <kbd data-shortcut-hint className="shrink-0 rounded bg-inset px-1.5 py-0.5 text-[11px] text-ink-3">{command.shortcut}</kbd>}
              </div>
            ))}
          </div>
        ))}
        {!results.length && <div role="status" className="px-4 py-10 text-center text-[13px] text-ink-3">No results for “{query}”</div>}
      </div>
      <div className={`flex shrink-0 gap-4 border-t border-line px-4 py-2.5 text-[11px] text-ink-3 ${showHints ? "" : "invisible"}`}><span>↑ ↓ Navigate</span><span>↵ Run</span><span className="ml-auto">esc Close</span></div>
    </dialog>, document.body,
  );
}
