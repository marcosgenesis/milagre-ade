import { SpinnerRing } from "../primitives/SpinnerRing";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  BubbleChatIcon,
  CircleIcon,
  Copy01Icon,
  FileEditIcon,
  Folder01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  LinkSquare02Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  ShieldAlertIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import GlideMenu from "@/components/primitives/GlideMenu";
import Tooltip from "@/components/primitives/Tooltip";
import { archiveChoices, type ArchiveMode, type ArchivePlan } from "@/lib/archive";
import { folderName, formatLineCount, type ChatMark } from "@/lib/chat-list";
import { useEditors } from "@/lib/editors";
import type { DiffStat, PullRequest } from "@/model";
import { BLOCKERS, pullRequestBlockers } from "@/lib/pr-blockers";

const toneClass = { red: "text-red", orange: "text-orange" } as const;

type HugeIconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function HugeIcon({ icon, size = 16 }: { icon: HugeIconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/** What the hover card tells about a chat. */
export type ChatDetails = {
  branch?: string;
  path?: string;
  diff?: DiffStat;
  pullRequest?: PullRequest;
  /** The chat's last turn failed. */
  failed?: boolean;
};

export type SidebarRecent = {
  id: string;
  label: string;
  prompt?: string;
  /** The mark at the left of the row; idle when absent. */
  mark?: ChatMark;
  /** Whether the chat is unread, whatever its mark shows. */
  unread?: boolean;
  details?: ChatDetails;
};

export type ChatRowActions = {
  onRename?: (id: string, title: string) => void;
  onMarkUnread?: (id: string, unread: boolean) => void;
  onReveal?: (id: string) => void;
  onOpenInEditor?: (id: string) => void;
  /** Opens the chat with its "Commit and open PR" dialog. */
  onCommit?: (id: string) => void;
  /** Looks at the chat's worktree when "Archive" is clicked, to decide what the confirm step offers. */
  onArchiveCheck?: (id: string) => Promise<ArchivePlan>;
  onArchive?: (id: string, mode: ArchiveMode, plan: ArchivePlan) => void;
};

/** What the confirm step offers when nothing is known about the worktree: only hide the chat. */
const HIDE_ONLY: ArchivePlan = { milagreOwned: false, shared: false, status: null };

const MARK_LABEL: Record<Exclude<ChatMark, "idle">, string> = {
  question: "Asking you",
  waiting: "Waiting for you",
  running: "Running",
  unread: "Unread",
};

const HOVER_CARD_DELAY = 500;
const HOVER_CARD_WIDTH = 256;
const MENU_WIDTH = 240;

type MenuEntry = { key: string; label: string; icon: HugeIconData; onSelect: () => void; disabled?: boolean; danger?: boolean; archiveChoice?: boolean };

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);


/* ─────────────────────────────────────────────────────────
 * CHAT MARK
 * One slot left of the label. A question shows a chat bubble,
 * an approval a shield, running spins a ring, unread is a plain
 * accent dot, and an idle chat keeps a faint dot so labels stay
 * aligned.
 * ───────────────────────────────────────────────────────── */
/** Marks that ask for you draw an icon, so a question and an approval read apart. The shield is orange like the approval card. */
const MARK_ICON = {
  question: { icon: BubbleChatIcon, tone: "text-accent" },
  waiting: { icon: ShieldAlertIcon, tone: "text-orange" },
} satisfies Partial<Record<ChatMark, { icon: HugeIconData; tone: string }>>;

function MarkIcon({ mark }: { mark: keyof typeof MARK_ICON }) {
  return <span className={`flex ${MARK_ICON[mark].tone}`}><HugeiconsIcon icon={MARK_ICON[mark].icon} size={13} strokeWidth={2} color="currentColor" /></span>;
}

function ChatMarkDot({ mark, topAligned = false }: { mark: ChatMark; topAligned?: boolean }) {
  const dot =
    mark === "unread" ? "size-2 bg-accent"
    : "size-1.5 bg-ink-3 opacity-40";
  return (
    <span className={`sidebar-copy mr-2 flex size-3 shrink-0 items-center justify-center ${topAligned ? "mt-1" : ""}`}>
      <span
        data-slot="chat-mark"
        data-mark={mark}
        {...(mark === "idle" ? { "aria-hidden": true } : { role: "img", "aria-label": MARK_LABEL[mark], title: MARK_LABEL[mark] })}
        className={mark === "running" ? "flex" : mark in MARK_ICON ? "flex" : `rounded-full ${dot}`}
      >
        {mark === "running" && <SpinnerRing size={12} />}
        {mark in MARK_ICON && <MarkIcon mark={mark as keyof typeof MARK_ICON} />}
      </span>
    </span>
  );
}

function recentInitials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function ChatRow({
  item,
  active,
  collapsed,
  onPick,
  actions,
  shortcutHint,
}: {
  item: SidebarRecent;
  active: boolean;
  collapsed: boolean;
  onPick: () => void;
  actions: ChatRowActions;
  shortcutHint?: string;
}) {
  const mark = item.mark ?? "idle";
  const pullRequest = !collapsed ? item.details?.pullRequest : undefined;
  const blocker = pullRequestBlockers(pullRequest)[0];
  const readyToMerge = pullRequest?.state === "OPEN" && pullRequest.readyToMerge && !blocker;
  const rowRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [card, setCard] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);

  const clearHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const hideCard = () => {
    clearHover();
    setCard(null);
  };
  const showCardSoon = () => {
    clearHover();
    if (menu || renaming) return;
    hoverTimer.current = window.setTimeout(() => {
      const row = rowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const sidebar = row.closest("aside")?.getBoundingClientRect() ?? rect;
      // Rows low in the window open the card upwards so it stays on screen.
      const flip = rect.top > window.innerHeight - 240;
      setCard({ top: flip ? window.innerHeight - rect.bottom - 4 : rect.top - 4, left: sidebar.right + 8, flip });
    }, HOVER_CARD_DELAY);
  };

  useEffect(() => clearHover, []);

  const openMenu = (x: number, y: number) => {
    hideCard();
    setMenu({ x: Math.min(x, window.innerWidth - MENU_WIDTH - 8), y });
  };

  return (
    <div
      ref={rowRef}
      className="group/row relative"
      onPointerEnter={showCardSoon}
      onPointerLeave={hideCard}
      onPointerDown={hideCard}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      {renaming ? (
        <div data-row className="sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] bg-hover-2 px-2">
          <ChatMarkDot mark={mark} />
          <RenameField
            initial={item.label}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null && title !== item.label) actions.onRename?.(item.id, title);
            }}
          />
        </div>
      ) : (
        <button
          data-row
          type="button"
          onClick={onPick}
          aria-current={active ? "page" : undefined}
          className={`sidebar-row relative z-10 mx-2 flex ${pullRequest ? "h-[46px] items-start pt-1.5" : "h-8 items-center"} rounded-[8px] px-2 text-left transition-[width,background-color,color,transform] duration-150 active:scale-[0.98] ${
            active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
          }`}
        >
          <span className="sidebar-chat-initials relative size-6 shrink-0 items-center justify-center rounded-[6px] bg-field text-[10px] font-semibold text-ink-2">
            {recentInitials(item.label)}
            {mark === "running" ? (
              <span aria-hidden className="absolute -right-1 -top-1 flex rounded-full bg-surface p-px">
                <SpinnerRing size={10} stroke={1.75} />
              </span>
            ) : mark !== "idle" && (
              <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-surface" />
            )}
          </span>
          <ChatMarkDot mark={mark} topAligned={Boolean(pullRequest)} />
          <span
            className={`sidebar-copy min-w-0 flex-1 truncate text-[14px] ${pullRequest ? "leading-5" : ""} transition-[padding] duration-150 ${shortcutHint ? "pr-10" : "group-hover/row:pr-6"} ${menu ? "pr-6" : ""} ${
              item.unread ? "font-semibold text-ink" : active ? "font-medium text-ink" : "font-medium text-ink-2"
            }`}
          >
            {item.label}
          </span>
        </button>
      )}

      {pullRequest && !renaming && (
        <Tooltip
          label={blocker ? `${BLOCKERS[blocker].long} · Pull request #${pullRequest.number}` : readyToMerge ? `Ready to merge · Pull request #${pullRequest.number}` : `${pullRequest.state === "MERGED" ? "Merged" : "Open"} pull request #${pullRequest.number}`}
          side="bottom"
          className="sidebar-copy absolute bottom-1 left-9 z-20 max-w-[calc(100%-72px)]"
        >
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${pullRequest.state === "MERGED" ? "merged " : ""}pull request #${pullRequest.number}${blocker ? `, ${BLOCKERS[blocker].short.toLowerCase()}` : readyToMerge ? ", ready to merge" : ""}`}
            data-chat-pr
            className="group/pr inline-flex min-w-0 items-center gap-1 rounded-sm text-[12px] leading-4 tabular-nums text-ink-3 no-underline hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={(event) => event.stopPropagation()}
          >
            <span aria-hidden className={`inline-flex group-hover/pr:hidden group-focus-visible/pr:hidden ${pullRequest.state === "MERGED" ? "text-purple-500" : blocker ? toneClass[BLOCKERS[blocker].tone] : "text-green"}`}>
              <HugeIcon icon={pullRequest.state === "MERGED" ? GitMergeIcon : readyToMerge ? Tick02Icon : GitPullRequestIcon} size={12} />
            </span>
            <span aria-hidden className="hidden group-hover/pr:inline-flex group-focus-visible/pr:inline-flex">
              <HugeIcon icon={LinkSquare02Icon} size={12} />
            </span>
            <span className="truncate">#{pullRequest.number}</span>
            {blocker && <span className={`shrink-0 ${toneClass[BLOCKERS[blocker].tone]}`}>{BLOCKERS[blocker].short}</span>}
            {readyToMerge && <span className="shrink-0 text-green">Ready</span>}
          </a>
        </Tooltip>
      )}

      {shortcutHint && !renaming && !menu && <kbd aria-hidden="true" data-shortcut-hint
        className={`pointer-events-none absolute right-3 top-1.5 z-30 rounded border border-line bg-surface px-1 text-[11px] leading-5 text-ink ${collapsed ? "right-1" : ""}`}>
        {shortcutHint}
      </kbd>}
      {!collapsed && !renaming && !shortcutHint && (
        <button
          ref={triggerRef}
          type="button"
          aria-label="Chat actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (menu) setMenu(null);
            else openMenu(rect.left, rect.bottom + 4);
          }}
          className={`absolute right-3 ${pullRequest ? "top-1" : "top-1/2 -translate-y-1/2"} z-20 flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-[opacity,background-color,color] duration-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 ${
            menu ? "bg-hover text-ink opacity-100" : "opacity-0"
          }`}
        >
          <HugeIcon icon={MoreVerticalIcon} size={16} />
        </button>
      )}

      {card && !menu && createPortal(<ChatHoverCard item={item} position={card} />, document.body)}
      {menu && (
        <ChatMenu
          item={item}
          position={menu}
          trigger={triggerRef}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(true)}
          actions={actions}
        />
      )}
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue={initial}
      aria-label="Chat name"
      maxLength={120}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value.trim());
        } else if (event.key === "Escape") {
          // Consumed here, so Escape doesn't also stop the open chat's turn.
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value.trim())}
      className="sidebar-copy min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ink outline-none"
    />
  );
}

/* ─────────────────────────────────────────────────────────
 * HOVER CARD
 * Opens beside the sidebar after a short rest on a row. All of
 * it is already in the project state (the diff stat is cached by
 * useWorktreeDiffs), so it never waits on git.
 * ───────────────────────────────────────────────────────── */
function ChatHoverCard({ item, position }: { item: SidebarRecent; position: { top: number; left: number; flip: boolean } }) {
  const { details = {} } = item;
  const blockers = pullRequestBlockers(details.pullRequest);
  const mark = item.mark ?? "idle";
  const status = mark !== "idle" ? { label: MARK_LABEL[mark], tone: mark === "running" ? "text-ink-2" : mark === "waiting" ? "text-orange" : "text-accent-ink" }
    : details.failed ? { label: "Last turn failed", tone: "text-red" }
    : null;
  return (
    <div
      role="tooltip"
      data-chat-hover-card
      className="pointer-events-none fixed z-[60] rounded-[12px] bg-surface p-3 shadow-overlay"
      style={{
        left: position.left,
        width: HOVER_CARD_WIDTH,
        ...(position.flip ? { bottom: position.top } : { top: position.top }),
        animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: position.flip ? "bottom left" : "top left",
      }}
    >
      <div className="line-clamp-3 text-[13.5px] font-semibold leading-snug text-ink">{item.label}</div>
      <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
        {status && (
          <CardLine icon={<span className="flex size-4 items-center justify-center"><ChatMarkDotInline mark={mark} failed={Boolean(details.failed)} /></span>}>
            <span className={status.tone}>{status.label}</span>
          </CardLine>
        )}
        {details.pullRequest && (
          <CardLine icon={<span className={details.pullRequest.state === "MERGED" ? "text-purple-500" : blockers[0] ? toneClass[BLOCKERS[blockers[0]].tone] : "text-green"}><HugeIcon icon={details.pullRequest.state === "MERGED" ? GitMergeIcon : GitPullRequestIcon} size={14} /></span>}>
            <span className="min-w-0 truncate leading-snug">#{details.pullRequest.number}{details.pullRequest.title ? ` · ${details.pullRequest.title}` : ""}</span>
          </CardLine>
        )}
        {blockers.map((blocker) => (
          <CardLine key={blocker} icon={<span className={toneClass[BLOCKERS[blocker].tone]}><HugeIcon icon={GitPullRequestIcon} size={14} /></span>}>
            <span className={toneClass[BLOCKERS[blocker].tone]}>{BLOCKERS[blocker].long}</span>
          </CardLine>
        ))}
        {details.pullRequest?.state === "OPEN" && details.pullRequest.readyToMerge && blockers.length === 0 && (
          <CardLine icon={<span className="text-green"><HugeIcon icon={Tick02Icon} size={14} /></span>}>
            <span className="text-green">Ready to merge</span>
          </CardLine>
        )}
        {details.diff && (
          <CardLine icon={<HugeIcon icon={FileEditIcon} size={14} />}>
            {details.diff.added === 0 && details.diff.removed === 0 ? (
              <span className="text-ink-3">No changes</span>
            ) : (
              <span className="tabular-nums">
                <span className="text-green">+{formatLineCount(details.diff.added)}</span>{" "}
                <span className="text-red">−{formatLineCount(details.diff.removed)}</span>
              </span>
            )}
          </CardLine>
        )}
        {details.branch && <CardLine icon={<HugeIcon icon={GitBranchIcon} size={14} />}><span className="truncate">{details.branch}</span></CardLine>}
        {details.path && <CardLine icon={<HugeIcon icon={Folder01Icon} size={14} />}><span className="truncate">{folderName(details.path)}</span></CardLine>}
      </div>
    </div>
  );
}

function ChatMarkDotInline({ mark, failed }: { mark: ChatMark; failed: boolean }) {
  if (mark === "running") return <SpinnerRing size={12} />;
  if (mark in MARK_ICON) return <MarkIcon mark={mark as keyof typeof MARK_ICON} />;
  return <span aria-hidden className={`size-2 rounded-full ${mark === "idle" && failed ? "bg-red" : "bg-accent"}`} />;
}

function CardLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">{icon}</span>
      <span className="flex min-w-0 flex-1">{children}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * ACTIONS MENU
 * From the row's ⋮ button or a right-click. Archive hides the
 * chat for good (there is no archived list), so it asks twice.
 * ───────────────────────────────────────────────────────── */
function ChatMenu({
  item,
  position,
  trigger,
  onClose,
  onRename,
  actions,
}: {
  item: SidebarRecent;
  position: { x: number; y: number };
  /** The ⋮ button toggles the menu itself, so a press on it isn't an outside press. */
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRename: () => void;
  actions: ChatRowActions;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  // What the confirm step offers: unknown until the worktree has been looked at.
  const [plan, setPlan] = useState<ArchivePlan | "checking" | null>(null);
  const [top, setTop] = useState(position.y);
  const { details = {} } = item;
  const running = item.mark === "running" || item.mark === "waiting" || item.mark === "question";

  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[data-menu-row]")?.focus();
  }, []);

  // The confirm step can add items and a line, so the height is measured again with it.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    // Opens upwards when there isn't room below.
    const height = menu.getBoundingClientRect().height;
    setTop(position.y + height > window.innerHeight - 8 ? Math.max(8, position.y - height - 8) : position.y);
    if (archiveArmed) menu.querySelector<HTMLElement>("[data-archive-choice]:not(:disabled)")?.focus();
  }, [position.y, archiveArmed, plan]);

  const armArchive = () => {
    setArchiveArmed(true);
    if (!actions.onArchiveCheck) {
      setPlan(HIDE_ONLY);
      return;
    }
    setPlan("checking");
    // A worktree that can't be checked only hides the chat, as before.
    actions.onArchiveCheck(item.id).then(setPlan, () => setPlan(HIDE_ONLY));
  };

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !trigger.current?.contains(target)) onClose();
    };
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, trigger]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const { editor } = useEditors();
  const copy = (text: string) => run(() => void navigator.clipboard.writeText(text).catch(() => {}));

  const resolved = plan && plan !== "checking" ? plan : null;
  const confirm = resolved ? archiveChoices({ plan: resolved, running }) : null;
  const archiveItems: Array<MenuEntry> = !archiveArmed
    ? [{ key: "archive", label: "Archive", icon: Archive02Icon, onSelect: armArchive, disabled: !actions.onArchive }]
    : confirm
      ? confirm.choices.map((choice) => ({
          key: `archive-${choice.mode}`,
          label: choice.label,
          icon: Archive02Icon,
          onSelect: run(() => resolved && actions.onArchive?.(item.id, choice.mode, resolved)),
          danger: choice.tone === "danger",
          archiveChoice: true,
        }))
      : [{ key: "archive-checking", label: "Checking worktree…", icon: Archive02Icon, onSelect: () => {}, disabled: true, archiveChoice: true }];

  const items: Array<MenuEntry | "divider"> = [
    { key: "copy-path", label: "Copy path", icon: Copy01Icon, onSelect: copy(details.path ?? ""), disabled: !details.path },
    { key: "copy-branch", label: "Copy branch name", icon: GitBranchIcon, onSelect: copy(details.branch ?? ""), disabled: !details.branch },
    { key: "rename", label: "Rename chat", icon: PencilEdit02Icon, onSelect: run(onRename), disabled: !actions.onRename },
    item.unread
      ? { key: "read", label: "Mark as read", icon: Tick02Icon, onSelect: run(() => actions.onMarkUnread?.(item.id, false)), disabled: !actions.onMarkUnread }
      : { key: "unread", label: "Mark as unread", icon: CircleIcon, onSelect: run(() => actions.onMarkUnread?.(item.id, true)), disabled: !actions.onMarkUnread },
    { key: "reveal", label: IS_MAC ? "Open in Finder" : "Open in file manager", icon: FolderOpenIcon, onSelect: run(() => actions.onReveal?.(item.id)), disabled: !actions.onReveal || !details.path },
    { key: "editor", label: editor ? `Open in ${editor.name}` : "No editor found", icon: SourceCodeIcon, onSelect: run(() => actions.onOpenInEditor?.(item.id)), disabled: !editor || !actions.onOpenInEditor || !details.path },
    // Every chat's folder came from `git worktree list`, so a chat with a folder is in a repository.
    { key: "commit", label: "Commit and open PR…", icon: GitPullRequestIcon, onSelect: run(() => actions.onCommit?.(item.id)), disabled: !actions.onCommit || !details.path },
    "divider",
    ...archiveItems,
  ];

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-row]:not(:disabled)") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      rows[(index + step + rows.length) % rows.length]?.focus();
    } else if (event.key === "Escape") {
      // Consumed here, so Escape doesn't also stop the open chat's turn.
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${item.label}`}
      data-chat-menu
      onKeyDown={moveFocus}
      className="fixed z-[70] rounded-[12px] bg-surface p-1.5 shadow-overlay"
      style={{ top, left: position.x, width: MENU_WIDTH, animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top left" }}
    >
      <GlideMenu className="flex flex-col gap-px" rowSelector="[data-menu-row]:not(:disabled)" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
        {items.map((entry, index) =>
          entry === "divider" ? (
            <div key={`divider-${index}`} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={entry.key}
              data-menu-row
              role="menuitem"
              type="button"
              disabled={entry.disabled}
              onClick={entry.onSelect}
              {...(entry.archiveChoice ? { "data-archive-choice": true } : {})}
              className={`relative z-10 flex w-full items-center gap-2 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2 disabled:opacity-40 ${entry.archiveChoice ? "min-h-8 py-1.5" : "h-8"} ${entry.danger ? "text-red" : "text-ink"}`}
            >
              <span className={`flex size-5 shrink-0 items-center justify-center ${entry.danger ? "text-red" : "text-ink-2"}`}>
                <HugeIcon icon={entry.icon} size={16} />
              </span>
              <span className={`min-w-0 flex-1 text-[13px] ${entry.archiveChoice ? "leading-snug" : "truncate"}`}>{entry.label}</span>
            </button>
          ),
        )}
      </GlideMenu>
      {confirm?.reason && <p data-archive-reason className="px-2 pb-1 pt-1.5 text-[12px] leading-snug text-ink-3">{confirm.reason}</p>}
    </div>,
    document.body,
  );
}
