import { ChatTitle } from "./ChatTitle";
import { SpinnerRing } from "../primitives/SpinnerRing";
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  BubbleChatIcon,
  EthernetPortIcon,
  CircleDotIcon,
  CircleIcon,
  Copy01Icon,
  FileEditIcon,
  Folder01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  Link04Icon,
  LinkSquare02Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  ShieldAlertIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import GlideMenu from "@/components/primitives/GlideMenu";
import Tooltip from "@/components/primitives/Tooltip";
import { ShortcutKeys } from "@/components/primitives/ShortcutKeys";
import { archiveChoices, type ArchiveMode, type ArchivePlan } from "@/lib/archive";
import { folderName, formatLineCount, type ChatMark } from "@/lib/chat-list";
import { rowPullRequests } from "@/lib/chat-pull-requests";
import { useEditors } from "@/lib/editors";
import type { AgentPort, DiffStat, PullRequest } from "@/model";
import { portUrl } from "@/lib/ports";
import { BLOCKERS, pullRequestBlockers } from "@/lib/pr-blockers";
import { ScrollArea } from "../primitives/ScrollArea";
import { useDismiss } from "../../lib/use-dismiss";

const toneClass = { red: "text-red", orange: "text-orange" } as const;

type HugeIconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function HugeIcon({ icon, size = 16 }: { icon: HugeIconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/** What the hover card tells about a chat. */
type ChatDetails = {
  branch?: string;
  path?: string;
  diff?: DiffStat;
  /** PRs the chat created or merged, then its worktree branch's PR, in the order they were made. */
  pullRequests?: PullRequest[];
  /** The chat's last turn failed. */
  failed?: boolean;
  /** Ports the chat's commands listen on. */
  ports?: AgentPort[];
};

export type SidebarRecent = {
  id: string;
  /** A local Chat preview can be opened, but cannot be edited until the host accepts it. */
  pending?: boolean;
  label: string;
  worktreeCount?: number;
  prompt?: string;
  /** The mark at the left of the row; idle when absent. */
  mark?: ChatMark;
  /** Whether the chat is unread, whatever its mark shows. */
  unread?: boolean;
  /** In the Pinned section, at `pinOrder` among the pinned chats. */
  pinned?: boolean;
  pinOrder?: number;
  details?: ChatDetails;
};

export type ChatRowActions = {
  onRename?: (id: string, title: string) => void;
  onMarkUnread?: (id: string, unread: boolean) => void;
  /** Pins the chat at `order` among the pinned chats (the end when left out), or unpins it (null). */
  onPin?: (id: string, order?: number | null) => void;
  onReveal?: (id: string) => void;
  onOpenInEditor?: (id: string) => void;
  /** Opens the chat with its "Commit and open PR" dialog. */
  onCommit?: (id: string) => void;
  /** Looks at the chat's worktree when "Archive" is clicked, to decide what the confirm step offers. */
  onArchiveCheck?: (id: string) => Promise<ArchivePlan>;
  onArchive?: (id: string, mode: ArchiveMode, plan: ArchivePlan) => Promise<unknown> | void;
};

/** What the confirm step offers when nothing is known about the worktree: only hide the chat. */
const HIDE_ONLY: ArchivePlan = { milagreOwned: false, shared: false, status: null };

const MARK_LABEL: Record<Exclude<ChatMark, "idle">, string> = {
  question: "Asking you",
  waiting: "Waiting for you",
  delegated: "Working on a Delegation",
  running: "Running",
  unread: "Unread",
};

const HOVER_CARD_DELAY = 500;
/** Time to cross from the row to the card before it closes, so its PR links can be clicked. */
const HOVER_CARD_GRACE = 250;
/** PR chips the row has room for; the rest are a count, and the hover card lists them all. */
const ROW_PR_LIMIT = 2;
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
  delegated: { icon: Link04Icon, tone: "text-accent" },
} satisfies Partial<Record<ChatMark, { icon: HugeIconData; tone: string }>>;

function MarkIcon({ mark }: { mark: keyof typeof MARK_ICON }) {
  return (
    <span className={`flex ${MARK_ICON[mark].tone}`}>
      <HugeiconsIcon icon={MARK_ICON[mark].icon} size={13} strokeWidth={2} color="currentColor" />
    </span>
  );
}

function ChatMarkDot({ mark, topAligned = false }: { mark: ChatMark; topAligned?: boolean }) {
  const dot = mark === "unread" ? "size-2 bg-accent" : "size-1.5 bg-ink-3 opacity-40";
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

// memo: the sidebar rebuilds on streamed batches, and a row only needs to render when its own item changes.
export const ChatRow = memo(function ChatRow({
  item,
  active,
  collapsed,
  onPick,
  actions,
  shortcutHint,
  dragging = false,
}: {
  item: SidebarRecent;
  active: boolean;
  collapsed: boolean;
  onPick: (item: SidebarRecent) => void;
  actions: ChatRowActions;
  shortcutHint?: string;
  /** The row is being dragged to a new place. */
  dragging?: boolean;
}) {
  const [archiving, setArchiving] = useState(false);
  const archivePending = useRef(false);
  const mark = item.mark ?? "idle";
  const pullRequests = !collapsed ? rowPullRequests(item.details?.pullRequests ?? []) : [];
  const hasPullRequests = pullRequests.length > 0;
  const shownPullRequests = pullRequests.slice(0, ROW_PR_LIMIT);
  const hiddenPullRequests = pullRequests.length - shownPullRequests.length;
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
    // Back on the row from the card: the card stays as it is. A chat being dragged over the row doesn't open it.
    if (menu || renaming || card || document.documentElement.hasAttribute("data-chat-drag")) return;
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

  // Leaving the row or the card gives the pointer time to reach the other one.
  const hideCardSoon = () => {
    clearHover();
    if (card) hoverTimer.current = window.setTimeout(() => setCard(null), HOVER_CARD_GRACE);
  };

  useEffect(() => clearHover, []);

  const openMenu = (x: number, y: number) => {
    if (item.pending || archivePending.current) return;
    hideCard();
    setMenu({ x: Math.min(x, window.innerWidth - MENU_WIDTH - 8), y });
  };

  return (
    <>
      <div
        ref={rowRef}
        data-chat-id={item.id}
        className={`group/row relative ${dragging ? "opacity-50" : ""}`}
        onPointerEnter={showCardSoon}
        onPointerLeave={hideCardSoon}
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
            onClick={() => onPick(item)}
            aria-busy={archiving || undefined}
            aria-label={archiving ? `Archiving ${item.label}` : undefined}
            aria-current={active ? "page" : undefined}
            className={`sidebar-row relative z-10 mx-2 flex ${hasPullRequests || item.worktreeCount !== undefined ? "h-[46px] items-start pt-1.5" : "h-8 items-center"} rounded-[8px] px-2 text-left transition-[width,background-color,color,transform] duration-150 active:scale-[0.98] ${
              active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
            }`}
          >
            <span className="sidebar-chat-initials relative size-6 shrink-0 items-center justify-center rounded-[6px] bg-field text-[10px] font-semibold text-ink-2">
              {recentInitials(item.label)}
              {archiving || mark === "running" ? (
                <span aria-hidden className="absolute -right-1 -top-1 flex rounded-full bg-surface p-px">
                  <SpinnerRing size={10} stroke={1.75} />
                </span>
              ) : (
                mark !== "idle" && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-surface" />
              )}
            </span>
            <ChatMarkDot mark={mark} topAligned={hasPullRequests} />
            <span
              className={`sidebar-copy min-w-0 flex-1 truncate text-[14px] ${hasPullRequests ? "leading-5" : ""} transition-[padding] duration-150 ${shortcutHint ? "pr-12" : "group-hover/row:pr-6"} ${menu ? "pr-6" : ""} ${
                item.unread ? "font-semibold text-ink" : active ? "font-medium text-ink" : "font-medium text-ink-2"
              }`}
            >
              {archiving ? (
                <span role="status" className="inline-flex items-center gap-2">
                  <SpinnerRing size={12} />
                  Archiving...
                </span>
              ) : (
                <ChatTitle label={item.label} />
              )}
              {item.worktreeCount !== undefined && <span className="block text-[11px] font-normal text-ink-3">{item.worktreeCount} Worktrees</span>}
            </span>
          </button>
        )}

        {hasPullRequests && !renaming && (
          <div data-chat-prs className="sidebar-copy absolute bottom-1 left-9 z-20 flex max-w-[calc(100%-72px)] min-w-0 items-center gap-2">
            {shownPullRequests.map((pr) => (
              <PullRequestChip key={pr.url} pr={pr} labelled={pullRequests.length === 1} />
            ))}
            {hiddenPullRequests > 0 && (
              <span
                data-chat-pr-more
                aria-label={`${hiddenPullRequests} more pull request${hiddenPullRequests === 1 ? "" : "s"}`}
                className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-3"
              >
                +{hiddenPullRequests}
              </span>
            )}
          </div>
        )}

        {shortcutHint && !renaming && !menu && (
          <ShortcutKeys
            shortcut={shortcutHint}
            aria-hidden="true"
            className={`pointer-events-none absolute top-1.5 z-30 ${collapsed ? "right-1" : "right-3"}`}
          />
        )}
        {!item.pending && !collapsed && !renaming && !shortcutHint && (
          <button
            ref={triggerRef}
            type="button"
            disabled={archiving}
            aria-label="Chat actions"
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (menu) setMenu(null);
              else openMenu(rect.left, rect.bottom + 4);
            }}
            className={`absolute right-3 ${hasPullRequests ? "top-1" : "top-1/2 -translate-y-1/2"} z-20 flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-[opacity,background-color,color] duration-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 ${
              menu ? "bg-hover text-ink opacity-100" : "opacity-0"
            }`}
          >
            <HugeIcon icon={MoreVerticalIcon} size={16} />
          </button>
        )}

        {menu && (
          <ChatMenu
            item={item}
            position={menu}
            trigger={triggerRef}
            onClose={() => setMenu(null)}
            onRename={() => setRenaming(true)}
            actions={{
              ...actions,
              onArchive: actions.onArchive
                ? async (id, mode, plan) => {
                    if (archivePending.current) return;
                    archivePending.current = true;
                    setArchiving(true);
                    try {
                      await actions.onArchive?.(id, mode, plan);
                    } finally {
                      archivePending.current = false;
                      setArchiving(false);
                    }
                  }
                : undefined,
            }}
          />
        )}
      </div>
      {/* Outside the row, so presses in the card don't reach the row's handlers through the portal. */}
      {card &&
        !menu &&
        createPortal(
          <ChatHoverCard item={item} position={card} onPointerEnter={clearHover} onPointerLeave={hideCardSoon} onOpenLink={hideCard} />,
          document.body,
        )}
    </>
  );
});

/** Merged is purple, a blocked PR takes its first blocker's tone, running CI is orange like GitHub's own dot, other open PRs are green. */
function prTone(pr: PullRequest) {
  const blocker = pullRequestBlockers(pr)[0];
  return pr.state === "MERGED" ? "text-purple-500" : blocker ? toneClass[BLOCKERS[blocker].tone] : isChecking(pr) ? "text-orange" : "text-green";
}

function prIcon(pr: PullRequest) {
  return pr.state === "MERGED" ? GitMergeIcon : isReadyToMerge(pr) ? Tick02Icon : isChecking(pr) ? CircleDotIcon : GitPullRequestIcon;
}

const isReadyToMerge = (pr: PullRequest) => pr.state === "OPEN" && pr.readyToMerge && pullRequestBlockers(pr).length === 0;
/** CI is still running and nothing else blocks the PR; a failure is a blocker and shows as one. */
const isChecking = (pr: PullRequest) => pr.state === "OPEN" && pr.checks === "running" && pullRequestBlockers(pr).length === 0;

/** One PR under the chat's title. Only a chat's single PR has room to spell out its blocker or "Ready". */
function PullRequestChip({ pr, labelled }: { pr: PullRequest; labelled: boolean }) {
  const blocker = pullRequestBlockers(pr)[0];
  const readyToMerge = isReadyToMerge(pr);
  const checking = isChecking(pr);
  return (
    <Tooltip
      label={
        blocker
          ? `${BLOCKERS[blocker].long} · Pull request #${pr.number}`
          : readyToMerge
            ? `Ready to merge · Pull request #${pr.number}`
            : checking
              ? `CI checks running · Pull request #${pr.number}`
              : `${pr.state === "MERGED" ? "Merged" : "Open"} pull request #${pr.number}`
      }
      side="bottom"
      className="min-w-0"
    >
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${pr.state === "MERGED" ? "merged " : ""}pull request #${pr.number}${blocker ? `, ${BLOCKERS[blocker].short.toLowerCase()}` : readyToMerge ? ", ready to merge" : checking ? ", CI running" : ""}`}
        data-chat-pr
        className="group/pr inline-flex min-w-0 items-center gap-1 rounded-sm text-[12px] leading-4 tabular-nums text-ink-3 no-underline hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden className={`inline-flex group-hover/pr:hidden group-focus-visible/pr:hidden ${prTone(pr)}`}>
          <HugeIcon icon={prIcon(pr)} size={12} />
        </span>
        <span aria-hidden className="hidden group-hover/pr:inline-flex group-focus-visible/pr:inline-flex">
          <HugeIcon icon={LinkSquare02Icon} size={12} />
        </span>
        <span className="truncate">#{pr.number}</span>
        {labelled && blocker && <span className={`shrink-0 ${toneClass[BLOCKERS[blocker].tone]}`}>{BLOCKERS[blocker].short}</span>}
        {labelled && readyToMerge && <span className="shrink-0 text-green">Ready</span>}
        {labelled && checking && <span className="shrink-0 text-orange">CI running</span>}
      </a>
    </Tooltip>
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
 * Opens beside the sidebar after a short rest on a row, and stays
 * while the pointer is on it so its PRs can be opened. All of it is
 * already in the project state (the diff stat is cached by
 * useWorktreeDiffs), so it never waits on git.
 * ───────────────────────────────────────────────────────── */
function ChatHoverCard({
  item,
  position,
  onPointerEnter,
  onPointerLeave,
  onOpenLink,
}: {
  item: SidebarRecent;
  position: { top: number; left: number; flip: boolean };
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** A PR in the card was opened; the card closes. */
  onOpenLink: () => void;
}) {
  const { details = {} } = item;
  const mark = item.mark ?? "idle";
  const status =
    mark !== "idle"
      ? { label: MARK_LABEL[mark], tone: mark === "running" ? "text-ink-2" : mark === "waiting" ? "text-orange" : "text-accent-ink" }
      : details.failed
        ? { label: "Last turn failed", tone: "text-red" }
        : null;
  return (
    <div
      data-chat-hover-card
      aria-label={item.label}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="fixed z-[60] rounded-[12px] bg-surface p-3 shadow-overlay"
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
          <CardLine
            icon={
              <span className="flex size-4 items-center justify-center">
                <ChatMarkDotInline mark={mark} failed={Boolean(details.failed)} />
              </span>
            }
          >
            <span className={status.tone}>{status.label}</span>
          </CardLine>
        )}
        {details.pullRequests?.length ? (
          <ScrollArea data-chat-card-prs className="-mx-1 flex max-h-[148px] flex-col gap-0.5">
            {details.pullRequests.map((pr) => {
              const blocker = pullRequestBlockers(pr)[0];
              return (
                <a
                  key={pr.url}
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-chat-card-pr
                  onClick={onOpenLink}
                  className="flex min-w-0 items-center gap-2 rounded-[6px] px-1 py-0.5 text-ink-2 no-underline hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className={`flex size-4 shrink-0 items-center justify-center ${prTone(pr)}`}>
                    <HugeIcon icon={prIcon(pr)} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate leading-snug">
                    <span className="tabular-nums">#{pr.number}</span>
                    {pr.title ? ` · ${pr.title}` : ""}
                  </span>
                  {blocker && <span className={`shrink-0 ${toneClass[BLOCKERS[blocker].tone]}`}>{BLOCKERS[blocker].short}</span>}
                  {isReadyToMerge(pr) && <span className="shrink-0 text-green">Ready to merge</span>}
                  {isChecking(pr) && <span className="shrink-0 text-orange">CI running</span>}
                </a>
              );
            })}
          </ScrollArea>
        ) : null}
        {details.ports?.length ? (
          <div data-chat-card-ports className="flex min-w-0 items-start gap-2">
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-3">
              <HugeIcon icon={EthernetPortIcon} size={14} />
            </span>
            <span className="flex min-w-0 flex-wrap gap-1">
              {details.ports.map((port) => (
                <a
                  key={port.port}
                  href={portUrl(port)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-chat-card-port
                  title={`${port.command} · open ${portUrl(port)}`}
                  onClick={onOpenLink}
                  className="rounded-[6px] bg-hover px-1.5 py-0.5 font-mono text-[11.5px] tabular-nums text-ink-2 no-underline hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  :{port.port}
                </a>
              ))}
            </span>
          </div>
        ) : null}
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
        {details.branch && (
          <CardLine icon={<HugeIcon icon={GitBranchIcon} size={14} />}>
            <span className="truncate">{details.branch}</span>
          </CardLine>
        )}
        {details.path && (
          <CardLine icon={<HugeIcon icon={Folder01Icon} size={14} />}>
            <span className="truncate">{folderName(details.path)}</span>
          </CardLine>
        )}
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
  // What the confirm step offers: null until the worktree has been looked at.
  const [plan, setPlan] = useState<ArchivePlan | null>(actions.onArchiveCheck ? null : HIDE_ONLY);
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

  // The worktree is checked as the menu opens, so "Archive" goes straight to its choice instead of
  // flashing a checking row. Archive stays disabled until the check is back.
  useEffect(() => {
    if (!actions.onArchiveCheck || !actions.onArchive) return;
    let live = true;
    // A worktree that can't be checked only hides the chat, as before.
    actions.onArchiveCheck(item.id).then(
      // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
      (next) => live && setPlan(next),
      () => live && setPlan(HIDE_ONLY),
    );
    return () => {
      live = false;
    };
    // Checked once per opening; the menu remounts each time it opens.
  }, []);

  useDismiss(true, onClose, (target) => !!(menuRef.current?.contains(target) || trigger.current?.contains(target)));

  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const { editor } = useEditors();
  const copy = (text: string) => run(() => void navigator.clipboard.writeText(text).catch(() => {}));

  const confirm = archiveArmed && plan ? archiveChoices({ plan, running }) : null;
  const archiveItems: Array<MenuEntry> =
    !confirm || !plan
      ? [{ key: "archive", label: "Archive", icon: Archive02Icon, onSelect: () => setArchiveArmed(true), disabled: !actions.onArchive || !plan }]
      : confirm.choices.map((choice) => ({
          key: `archive-${choice.mode}`,
          label: choice.label,
          icon: Archive02Icon,
          onSelect: run(() => actions.onArchive?.(item.id, choice.mode, plan)),
          danger: choice.tone === "danger",
          archiveChoice: true,
        }));

  // Enter confirms the armed archive wherever focus is, since a mouse click on "Archive" leaves it on the page.
  // A row focused with the arrow keys keeps Enter for itself.
  const confirmEntry = archiveItems.length === 1 && archiveItems[0].archiveChoice && !archiveItems[0].disabled ? archiveItems[0] : null;
  useEffect(() => {
    if (!confirmEntry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches("[data-menu-row]") && !active.matches("[data-archive-choice]")) return;
      event.preventDefault();
      event.stopPropagation();
      confirmEntry.onSelect();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmEntry]);

  const items: Array<MenuEntry | "divider"> = [
    { key: "copy-path", label: "Copy path", icon: Copy01Icon, onSelect: copy(details.path ?? ""), disabled: !details.path },
    { key: "copy-branch", label: "Copy branch name", icon: GitBranchIcon, onSelect: copy(details.branch ?? ""), disabled: !details.branch },
    { key: "rename", label: "Rename chat", icon: PencilEdit02Icon, onSelect: run(onRename), disabled: !actions.onRename },
    item.unread
      ? { key: "read", label: "Mark as read", icon: Tick02Icon, onSelect: run(() => actions.onMarkUnread?.(item.id, false)), disabled: !actions.onMarkUnread }
      : {
          key: "unread",
          label: "Mark as unread",
          icon: CircleIcon,
          onSelect: run(() => actions.onMarkUnread?.(item.id, true)),
          disabled: !actions.onMarkUnread,
        },
    {
      key: "reveal",
      label: IS_MAC ? "Open in Finder" : "Open in file manager",
      icon: FolderOpenIcon,
      onSelect: run(() => actions.onReveal?.(item.id)),
      disabled: !actions.onReveal || !details.path,
    },
    {
      key: "editor",
      label: editor ? `Open in ${editor.name}` : "No editor found",
      icon: SourceCodeIcon,
      onSelect: run(() => actions.onOpenInEditor?.(item.id)),
      disabled: !editor || !actions.onOpenInEditor || !details.path,
    },
    // Every chat's folder came from `git worktree list`, so a chat with a folder is in a repository.
    {
      key: "commit",
      label: "Commit and open PR…",
      icon: GitPullRequestIcon,
      onSelect: run(() => actions.onCommit?.(item.id)),
      disabled: !actions.onCommit || !details.path,
    },
    item.pinned
      ? { key: "unpin", label: "Unpin", icon: PinOffIcon, onSelect: run(() => actions.onPin?.(item.id, null)), disabled: !actions.onPin }
      : { key: "pin", label: "Pin", icon: PinIcon, onSelect: run(() => actions.onPin?.(item.id)), disabled: !actions.onPin },
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
      {confirm?.reason && (
        <p data-archive-reason className="px-2 pb-1 pt-1.5 text-[12px] leading-snug text-ink-3">
          {confirm.reason}
        </p>
      )}
    </div>,
    document.body,
  );
}
