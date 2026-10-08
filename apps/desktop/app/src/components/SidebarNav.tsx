import type { NamedProjectLink } from "@milagre/shared/model";
import { ProjectAvatarStack } from "./ProjectAvatarStack";
import { useProjectImages } from "../lib/project-images";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  FolderAddIcon,
  FolderOpenIcon,
  GitMergeIcon,
  Link04Icon,
  MoreVerticalIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import GlideMenu from "@/components/primitives/GlideMenu";
import Tooltip from "@/components/primitives/Tooltip";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { shortcutModifier, useShortcutHints } from "../lib/shortcut-hints";
import { ScrollArea } from "./primitives/ScrollArea";
import { projectMenuActions, type ProjectMenuKey } from "@/lib/reveal";
import { projectRows, stableOrder, type ProjectRow, type RecentProject } from "@/lib/project-list";
import { ChatRow, type ChatRowActions, type SidebarRecent } from "./sidebar/ChatRow";
import { useDismiss } from "../lib/use-dismiss";
import { dropIntent, pinOrderAt, type DropIntent, type DropZone } from "@/lib/chat-list";
import type { ProjectLink } from "@/electron";
import { ipcErrorMessage } from "@milagre/shared/result";
import { useSettings } from "../lib/settings";
import { RECENT_PROJECTS_CHANGED } from "../lib/project-list";
import { cachedProjectCopy, scopeChats, useScopeStates } from "../lib/sidebar-scopes";

type HugeIconProps = { size?: number; className?: string };
type HugeIconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function HugeIcon({ icon, size = 16, className }: HugeIconProps & { icon: HugeIconData }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" className={className} />;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});
const PROJECT_MENU_ICONS: Record<ProjectMenuKey, HugeIconData> = {
  reveal: FolderOpenIcon,
  "copy-path": Copy01Icon,
  "copy-name": Copy01Icon,
  settings: Settings01Icon,
};

const IconCheckmark1Small = (props: HugeIconProps) => <HugeIcon icon={Tick02Icon} {...props} />;
const IconChevronDownSmall = (props: HugeIconProps) => <HugeIcon icon={ArrowDown01Icon} {...props} />;
const IconCrossSmall = (props: HugeIconProps) => <HugeIcon icon={Cancel01Icon} {...props} />;
const IconFolderAdd = (props: HugeIconProps) => <HugeIcon icon={FolderAddIcon} {...props} />;
const IconMagnifyingGlass = (props: HugeIconProps) => <HugeIcon icon={Search01Icon} {...props} />;
const IconPlusMedium = (props: HugeIconProps) => <HugeIcon icon={Add01Icon} {...props} />;
const IconPopsicle2 = (props: HugeIconProps) => <HugeIcon icon={SparklesIcon} {...props} />;
const IconSettingsGear1 = (props: HugeIconProps) => <HugeIcon icon={Settings01Icon} {...props} />;

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * Shared by the design-system preview and the harness shell.
 * Default: a project menu at the top, then primary navigation,
 * searchable chat history, and a collapse that preserves icon
 * alignment. Experimental (Settings > sidebarAllProjects): every
 * Project and Link listed with its chats instead of the menu.
 * ───────────────────────────────────────────────────────── */

const WORKSPACE = { key: "creamery", name: "Creamery Ops", monogram: "C" };

const DEFAULT_RECENTS: SidebarRecent[] = [
  { id: "suppliers", label: "Supplier records" },
  { id: "todos", label: "Urgent to-dos this morning" },
  { id: "flavor", label: "Flavor page ticket" },
  { id: "workload", label: "Workload summary" },
  { id: "offboarding", label: "Off-board a supplier" },
  { id: "restock", label: "Batch restock function" },
  { id: "edits", label: "Propose flavor edits" },
  { id: "subway", label: "Subway surfing" },
];

type SidebarNavProps = {
  selectedLink?: { id: string; projects: Array<{ path: string; name: string }> };
  onSwitchLink?: (id: string) => void;
  onLinkProject?: () => void;
  workspaceName?: string;
  workspaceImage?: string | null;
  /** Runs the folder dialog. */
  onOpenProject?: () => void;
  activeTitle?: string | null;
  /** Controlled selection of a recent by id; takes precedence over title matching. */
  activeId?: string | null;
  className?: string;
  fill?: boolean;
  onNewChat?: () => void;
  onPick?: (id: string, label: string, prompt?: string) => void;
  onOpenSettings?: () => void;
  onOpenCanvas?: () => void;
  canvasActive?: boolean;
  onOpenCommands?: () => void;
  hintsEnabled?: boolean;
  /** The project folder, for the project menu's reveal and copy path. */
  projectPath?: string;
  /** Opens a project from the recent list in the project menu. */
  onSwitchProject?: (path: string) => void;
  /** Other projects with a chat that waits on the user: their rows and the project button get a dot. */
  attentionPaths?: string[];
  /** Opens a Project's settings, by its path. */
  onOpenProjectSettings?: (path: string) => void;
  /** Starts a new chat in another Project (its path) or Link (`milagre-link:` key), switching to it first. */
  onNewChatInScope?: (scopeKey: string) => void;
  recents?: SidebarRecent[];
  /** What the chat rows' menu can do; an action left out is shown disabled. */
  chatActions?: ChatRowActions;
  /** Plan usage, shown above the footer buttons in both the expanded and collapsed sidebar. */
  usage?: ReactNode;
  variant?: string;
  /** Chat keys with a turn streaming, and with one waiting on the user, joined by newlines (one string keeps memo cheap). */
  runningKeys?: string;
  waitingKeys?: string;
  /** Of those waiting, the chats whose next card is a question. */
  askingKeys?: string;
  /** Opens a chat of another Project (its path) or Link (`milagre-link:` key) from the all-Projects sidebar. */
  onOpenScopeChat?: (scopeKey: string, id: string) => void;
};

const NO_CHAT_ACTIONS: ChatRowActions = {};
const NEVER_ACTIVE = () => false;
// Groups of the all-Projects sidebar the user folded, by Project path or Link key; the rest stay open.
const CLOSED_SCOPES_KEY = "milagre.sidebarClosedScopes";
function readClosedScopes(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(CLOSED_SCOPES_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

type ScopeMenuItem = {
  key: string;
  label: string;
  icon: HugeIconData;
  run: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

/** A Project or Link heading in the sidebar: folds its chats. Hovered, the chevron takes the icon's place, as in Paseo; the ⋯ menu and the + sit on the right. */
function ScopeHeader({
  name,
  icon,
  open,
  current,
  attention,
  onToggle,
  onNewChat,
  menu,
}: {
  name: string;
  icon: ReactNode;
  open: boolean;
  current: boolean;
  attention: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  /** The ⋯ menu's rows; none hides the button. */
  menu: ScopeMenuItem[];
}) {
  return (
    <div className="group/scope relative mx-2 flex h-8 items-center">
      <button
        type="button"
        data-scope-toggle
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
        onClick={onToggle}
        className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] pl-2 pr-[60px] text-left hover:bg-hover-2"
      >
        {/* A Link's stacked avatars are wider than a Project's icon, so the slot grows with them. */}
        <span className="relative flex h-5 min-w-5 shrink-0 items-center justify-center text-ink">
          <span className="flex items-center justify-center transition-opacity duration-100 group-hover/scope:opacity-0 group-has-[[data-scope-toggle]:focus-visible]/scope:opacity-0">
            {icon}
          </span>
          <span
            aria-hidden
            data-scope-chevron
            className={`absolute inset-y-0 left-0 flex w-5 items-center justify-center text-ink-3 opacity-0 transition-[opacity,transform] duration-150 group-hover/scope:opacity-100 group-has-[[data-scope-toggle]:focus-visible]/scope:opacity-100 ${open ? "" : "-rotate-90"}`}
          >
            <IconChevronDownSmall size={14} />
          </span>
        </span>
        <span data-scope-name className={`min-w-0 flex-1 truncate text-[13px] ${current ? "font-medium text-ink" : "text-ink-2"}`}>
          {name}
        </span>
        {attention && <AttentionDot />}
      </button>
      <div className="absolute right-1 flex items-center gap-0.5">
        {menu.length > 0 && <ScopeMenuButton name={name} items={menu} />}
        <Tooltip label="New chat" shortcut={current ? "⌘N" : undefined} align="end">
          <button
            type="button"
            data-scope-action
            aria-label={current ? "New chat" : `New chat in ${name}`}
            onClick={onNewChat}
            className={`${SCOPE_HEADER_BUTTON} ${current ? "" : "opacity-0 group-hover/scope:opacity-100 focus-visible:opacity-100"}`}
          >
            <IconPlusMedium size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** A Project's or Link's ⋯ button; its rows open in a panel on the body, under the button. */
function ScopeMenuButton({ name, items }: { name: string; items: ScopeMenuItem[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return false;
    // Right-aligned to the button, but never past the window's left edge in a narrow sidebar.
    setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 224) });
    return true;
  };
  const close = () => setOpen(false);
  const openMenu = () => {
    if (place()) setOpen(true);
  };

  useDismiss(open, close, (target) => !!target.closest("[data-scope-menu], [data-scope-menu-panel]"), place);
  useLayoutEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("[data-menu-row]:not(:disabled)")?.focus();
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-menu-row]:not(:disabled)") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      rows[(index + step + rows.length) % rows.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  return (
    <>
      <Tooltip label="More" align="end">
        <button
          ref={buttonRef}
          type="button"
          data-scope-menu
          aria-label={`${name} actions`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? close() : openMenu())}
          className={`${SCOPE_HEADER_BUTTON} ${open ? "opacity-100" : "opacity-0 group-hover/scope:opacity-100 focus-visible:opacity-100"}`}
        >
          <HugeIcon icon={MoreVerticalIcon} size={14} />
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={`${name} actions`}
            onKeyDown={moveFocus}
            data-scope-menu-panel
            className="fixed z-50 flex max-h-[calc(100vh-16px)] w-56 flex-col overflow-hidden rounded-[14px] bg-surface shadow-overlay"
            style={{
              top: position.top,
              left: position.left,
              animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "top right",
            }}
          >
            <ScrollArea className="p-1.5">
              <GlideMenu className="flex flex-col gap-px" rowSelector="[data-menu-row]:not(:disabled)" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
                {items.map((item) => (
                  <Fragment key={item.key}>
                    {item.separatorBefore && <div className="my-1 h-px bg-line" />}
                    <button
                      data-menu-row
                      data-scope-menu-item={item.key}
                      role="menuitem"
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        close();
                        item.run();
                      }}
                      className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2 disabled:opacity-40"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                        <HugeIcon icon={item.icon} size={16} />
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${item.destructive ? "text-red" : "text-ink"}`}>{item.label}</span>
                    </button>
                  </Fragment>
                ))}
              </GlideMenu>
            </ScrollArea>
          </div>,
          document.body,
        )}
    </>
  );
}

const NO_PATHS: string[] = [];
// The last lists and group order any sidebar loaded. A switch between a Project and a Link mounts the other sidebar,
// which starts from these instead of empty, so its Links and groups don't blink while it reads them again.
const lastLists = {
  links: [] as NamedProjectLink[],
  registered: [] as Array<{ id: string; name: string; path: string }>,
  recent: [] as RecentProject[],
  recentLoaded: false,
  order: [] as string[],
};

function AttentionDot({ className = "" }: { className?: string }) {
  return <span role="img" aria-label="Needs attention" title="A chat here waits for you" className={`size-2 shrink-0 rounded-full bg-orange ${className}`} />;
}

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  // A 32px control with 6px of space on each side.
  collapsedWidth: 44,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

// Dragging the sidebar's right edge widens it between these bounds; the width survives restarts.
const SIDEBAR_MIN_WIDTH = SIDEBAR_MOTION.expandedWidth;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_WIDTH_KEY = "milagre.sidebarWidth";

const clampSidebarWidth = (width: number) => Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));

function readSidebarWidth() {
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(saved) && saved > 0 ? clampSidebarWidth(saved) : SIDEBAR_MIN_WIDTH;
}

// Narrower than this, the sidebar collapses on its own so the chat keeps its room. It can still be expanded.
const AUTO_COLLAPSE_QUERY = "(max-width: 1024px)";

// The + and ⋯ on a Project's header: smaller than the row, so their hover fill doesn't read as a second row.
const SCOPE_HEADER_BUTTON =
  "flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]";

const CHATS_HEADER_BUTTON =
  "flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]";

const BOTTOM_BAR_BUTTON =
  "flex items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]";

export function GlideGroup({ children }: { children: ReactNode }) {
  return (
    <GlideMenu rowSelector="[data-row]" highlightClassName="sidebar-glide-highlight rounded-[7px] bg-hover-2" className="group/glide flex flex-col gap-px">
      {children}
    </GlideMenu>
  );
}

export function RailButton({
  icon,
  label,
  active = false,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: string;
  onClick?: () => void;
}) {
  return (
    <button
      data-row
      type="button"
      onClick={onClick}
      className={`sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] px-2 text-left
        transition-[width,background-color,color,transform] duration-150 active:scale-[0.98]
        ${active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""}`}
    >
      <span className={`flex size-5 shrink-0 items-center justify-center ${active ? "text-ink" : "text-ink-2"}`}>{icon}</span>
      <span className={`sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>{label}</span>
      {count && <span className="sidebar-copy mr-2 shrink-0 text-[12px] font-medium tabular-nums text-ink-3">{count}</span>}
    </button>
  );
}

function WorkspaceMenu({
  position,
  onClose,
  workspace,
  projectPath,
  onOpenProjectSettings,
  projects,
  onSwitchProject,
  onOpenProject,
  onForgetProject,
  selectedLink,
  links,
  registeredProjects,
  onSwitchLink,
  onLinkProject,
  attentionPaths,
}: {
  position: { top: number; left: number };
  onClose: () => void;
  workspace: { name: string; monogram: string; image?: string | null };
  projectPath?: string;
  onOpenProjectSettings?: (path: string) => void;
  projects: ProjectRow[];
  onSwitchProject?: (path: string) => void;
  onOpenProject?: () => void;
  onForgetProject?: (path: string) => void;
  selectedLink?: SidebarNavProps["selectedLink"];
  links: NamedProjectLink[];
  registeredProjects: Array<{ id: string; path: string; name: string }>;
  onSwitchLink?: (id: string) => void;
  onLinkProject?: () => void;
  attentionPaths: string[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const imageOf = useProjectImages(projects.filter((row) => !row.current).map((row) => row.path));
  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[data-menu-row]:not(:disabled)")?.focus();
  }, []);

  // Switching projects stops nothing: the other project's turns keep running in the background.
  const go = (open: () => void) => {
    onClose();
    open();
  };
  // Focus inside the row (its own button, or the × just clicked) moves to a neighbour before the row goes,
  // so the arrow keys keep working.
  const forget = (path: string, item: HTMLElement | null) => {
    if (item?.contains(document.activeElement)) {
      const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-row]:not(:disabled)") ?? [])];
      const index = rows.findIndex((row) => item.contains(row));
      (rows[index + 1] ?? rows[index - 1])?.focus();
    }
    onForgetProject?.(path);
  };

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-row]:not(:disabled)") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      rows[(index + step + rows.length) % rows.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});
  const projectActions: Record<ProjectMenuKey, { run: () => void; disabled: boolean }> = {
    reveal: { run: () => void window.milagre?.revealInFolder(projectPath ?? "").catch(() => {}), disabled: !projectPath },
    "copy-path": { run: () => copy(projectPath ?? ""), disabled: !projectPath },
    "copy-name": { run: () => copy(workspace.name), disabled: false },
    settings: { run: () => onOpenProjectSettings?.(projectPath ?? ""), disabled: !onOpenProjectSettings || !projectPath },
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${workspace.name} actions`}
      onKeyDown={moveFocus}
      data-workspace-menu
      className="fixed z-50 flex max-h-[calc(100vh-16px)] w-64 flex-col overflow-hidden rounded-[14px] bg-surface shadow-overlay"
      style={{
        top: position.top,
        left: position.left,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "top left",
      }}
    >
      <ScrollArea className="p-1.5">
        <GlideMenu className="flex flex-col gap-px" rowSelector="[data-menu-row]:not(:disabled)" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
          {!selectedLink &&
            projectMenuActions(IS_MAC).map((item) => (
              <button
                key={item.key}
                data-menu-row
                data-project-action={item.key}
                role="menuitem"
                type="button"
                disabled={projectActions[item.key].disabled}
                onClick={() => {
                  onClose();
                  projectActions[item.key].run();
                }}
                className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2 disabled:opacity-40"
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                  <HugeIcon icon={PROJECT_MENU_ICONS[item.key]} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{item.label}</span>
              </button>
            ))}
          {!selectedLink && <div className="my-1 h-px bg-line" />}
          <p className="px-2 py-1 text-[11px] font-medium text-ink-3">Projects</p>
          {projects.map((row) => {
            return (
              <div key={row.path} data-project-item className="group/project relative">
                <button
                  data-menu-row
                  data-project-row={row.path}
                  role="menuitemradio"
                  aria-checked={row.current}
                  type="button"
                  title={row.current ? row.path : `${row.path}\nPress Delete to remove from the list`}
                  {...(row.current ? {} : { "aria-keyshortcuts": "Delete" })}
                  onClick={() => (row.current ? onClose() : go(() => onSwitchProject?.(row.path)))}
                  onKeyDown={(event) => {
                    if (row.current || (event.key !== "Delete" && event.key !== "Backspace")) return;
                    event.preventDefault();
                    forget(row.path, event.currentTarget.closest("[data-project-item]"));
                  }}
                  className="relative z-10 flex h-10 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-semibold text-surface">
                    <WorkspaceIcon src={row.current ? workspace.image : imageOf(row.path)} fallback={row.initial} />
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[13.5px] text-ink ${row.current ? "font-medium" : "group-hover/project:pr-6"}`}>
                    {row.name}
                  </span>
                  {row.current && (
                    <span className="shrink-0 text-ink">
                      <IconCheckmark1Small size={18} />
                    </span>
                  )}
                  {!row.current && attentionPaths.includes(row.path) && <AttentionDot className="mr-1 group-hover/project:opacity-0" />}
                </button>
                {!row.current && (
                  <button
                    type="button"
                    tabIndex={-1}
                    data-forget-project={row.path}
                    aria-label={`Remove ${row.name} from the list`}
                    title="Remove from the list"
                    onClick={(event) => forget(row.path, event.currentTarget.closest("[data-project-item]"))}
                    className="absolute right-1.5 top-2 z-20 flex size-6 items-center justify-center rounded-[6px] text-ink-3 opacity-0 transition-[opacity,background-color,color] duration-100 hover:bg-hover hover:text-ink group-hover/project:opacity-100"
                  >
                    <IconCrossSmall size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {links.length > 0 && (
            <>
              <div className="my-1 h-px bg-line" />
              <p className="px-2 py-1 text-[11px] font-medium text-ink-3">Links</p>
              {links.map((link) => (
                <button
                  key={link.id}
                  data-menu-row
                  data-link-row={link.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedLink?.id === link.id}
                  onClick={() => go(() => onSwitchLink?.(link.id))}
                  className="relative z-10 flex min-h-10 items-center gap-2 rounded-[8px] px-2 py-1 text-left outline-none focus-visible:bg-hover-2"
                >
                  <ProjectAvatarStack
                    projects={link.projectIds.map((id) => registeredProjects.find((project) => project.id === id) ?? { path: "", name: "Project" })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{link.name}</span>
                    <span className="block text-[11px] text-ink-3">{link.projectIds.length} Projects</span>
                  </span>
                  {selectedLink?.id === link.id && <IconCheckmark1Small size={18} />}
                </button>
              ))}
            </>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            data-menu-row
            data-open-project
            role="menuitem"
            type="button"
            onClick={() => go(() => onOpenProject?.())}
            className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2"
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <IconPlusMedium size={16} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">Open project…</span>
          </button>
          {onLinkProject && (
            <button
              data-menu-row
              type="button"
              role="menuitem"
              onClick={() => go(onLinkProject)}
              className="relative z-10 flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2"
            >
              <span className="flex size-5 items-center justify-center text-ink-2">
                <HugeIcon icon={Link04Icon} size={16} />
              </span>
              <span className="text-[13.5px]">Link projects…</span>
            </button>
          )}
        </GlideMenu>
      </ScrollArea>
    </div>,
    document.body,
  );
}

// memo: App rebuilds on every streamed batch and keystroke elsewhere; the sidebar only follows its own props.
export default memo(function SidebarNav({
  workspaceName = WORKSPACE.name,
  workspaceImage,
  selectedLink,
  onLinkProject,
  onOpenProject,
  onSwitchLink,
  onSwitchProject,
  activeTitle,
  activeId,
  className = "",
  fill = false,
  onNewChat,
  onPick,
  onOpenSettings,
  onOpenCanvas,
  canvasActive = false,
  onOpenCommands,
  hintsEnabled = true,
  projectPath,
  onOpenProjectSettings,
  attentionPaths = NO_PATHS,
  recents = DEFAULT_RECENTS,
  chatActions = NO_CHAT_ACTIONS,
  usage,
  runningKeys = "",
  waitingKeys = "",
  askingKeys = "",
  onOpenScopeChat,
  onNewChatInScope,
}: SidebarNavProps) {
  const { sidebarAllProjects, chatOrder } = useSettings();
  const [listsChanged, setListsChanged] = useState(0);
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(AUTO_COLLAPSE_QUERY).matches);
  // True only while the sidebar is collapsed because the window got narrow, so widening it brings the sidebar back.
  const autoCollapsed = useRef(collapsed);
  const [expandedWidth, setExpandedWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [namedLinks, setNamedLinks] = useState(() => lastLists.links);
  const [registeredProjects, setRegisteredProjects] = useState(() => lastLists.registered);
  const [recentProjects, setRecentProjects] = useState(() => lastLists.recent);
  const [recentLoaded, setRecentLoaded] = useState(() => lastLists.recentLoaded);
  // The Projects' group order for this session; see stableOrder.
  const scopeOrder = useRef<string[]>(lastLists.order);
  const showHints = useShortcutHints() && hintsEnabled && !workspaceOpen;
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);

  const selectedTitle = activeTitle === undefined ? demoActiveTitle : activeTitle;
  // One identity for every row, so memo(ChatRow) skips when the sidebar re-renders.
  const pickChat = useCallback(
    (item: SidebarRecent) => {
      if (activeTitle === undefined) setDemoActiveTitle(item.label);
      onPick?.(item.id, item.label, item.prompt);
    },
    [activeTitle, onPick],
  );
  const workspace = { name: workspaceName, image: workspaceImage, monogram: workspaceName.trim().slice(0, 1).toUpperCase() || "M" };
  const projects = projectPath
    ? projectRows({ recent: recentProjects, currentPath: projectPath, currentName: workspaceName })
    : recentProjects.map((project) => ({ ...project, initial: project.name.slice(0, 1).toUpperCase(), current: false }));

  // Read on mount and again each time the menu opens, so a folder that's gone drops out.
  useEffect(() => {
    let live = true;
    window.milagre?.listRecentProjects?.().then(
      (list) => {
        if (live) {
          setRecentProjects(Array.isArray(list) ? list : []);
          setRecentLoaded(true);
        }
      },
      () => {},
    );
    void window.milagre
      ?.listNamedLinks?.()
      .then((links) => {
        if (live) setNamedLinks(Array.isArray(links) ? links : []);
      })
      .catch(() => {});
    void window.milagre
      ?.listProjects?.()
      .then((projects) => {
        if (live) setRegisteredProjects(Array.isArray(projects) ? projects : []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectPath, workspaceOpen, selectedLink?.id, sidebarAllProjects, listsChanged]);
  useEffect(() => {
    const changed = () => setListsChanged((count) => count + 1);
    window.addEventListener(RECENT_PROJECTS_CHANGED, changed);
    return () => window.removeEventListener(RECENT_PROJECTS_CHANGED, changed);
  }, []);

  // Every recent Project the user didn't hide, then every Link, like the phone's list. The open one is always there.
  const currentKey = selectedLink ? `milagre-link:${selectedLink.id}` : (projectPath ?? "");
  const projectScopes = projects
    .filter((row) => row.current || !recentProjects.find((project) => project.path === row.path)?.hidden)
    .map((row) => ({ key: row.path, name: row.name, initial: row.initial, link: null as NamedProjectLink | null }));
  if (recentLoaded)
    scopeOrder.current = stableOrder(
      scopeOrder.current,
      projectScopes.map((scope) => scope.key),
    );
  const orderedProjects = recentLoaded ? scopeOrder.current.map((key) => projectScopes.find((scope) => scope.key === key)!).filter(Boolean) : projectScopes;
  // The next sidebar to mount (a Link's, or the Project one again) starts from what this one has.
  useEffect(() => {
    Object.assign(lastLists, { links: namedLinks, registered: registeredProjects, recent: recentProjects, recentLoaded, order: scopeOrder.current });
  });
  const scopes = [...orderedProjects, ...namedLinks.map((link) => ({ key: `milagre-link:${link.id}`, name: link.name, initial: "", link }))];
  const scopeImage = useProjectImages(sidebarAllProjects ? scopes.filter((scope) => !scope.link).map((scope) => scope.key) : NO_PATHS);
  const showAll = sidebarAllProjects && !collapsed;
  const scopeStates = useScopeStates(
    showAll,
    scopes.filter((scope) => scope.key !== currentKey).map((scope) => scope.key),
  );
  const marks = useMemo(
    () => ({
      running: new Set(runningKeys.split("\n").filter(Boolean)),
      waiting: new Set(waitingKeys.split("\n").filter(Boolean)),
      asking: new Set(askingKeys.split("\n").filter(Boolean)),
    }),
    [runningKeys, waitingKeys, askingKeys],
  );
  // Another Project's or Link's chats can be pinned from here; the row menu's other actions stay with the open one.
  // One object per scope, so its rows keep their memo.
  const scopeActions = useRef(new Map<string, ChatRowActions>());
  const actionsFor = (key: string) => {
    let actions = scopeActions.current.get(key);
    if (!actions) {
      actions = {
        onPin: (id, order) =>
          void window.milagre
            .patchChat(key, Number(id), order == null ? { pinned: false, pin_order: undefined } : { pinned: true, pin_order: order })
            .catch(() => {}),
      };
      scopeActions.current.set(key, actions);
    }
    return actions;
  };
  const scopePickers = useRef(new Map<string, (item: SidebarRecent) => void>());
  const pickerFor = (key: string) => {
    let pick = scopePickers.current.get(key);
    if (!pick) {
      pick = (item) => openScope.current(key, item.id);
      scopePickers.current.set(key, pick);
    }
    return pick;
  };
  const openScope = useRef((key: string, id: string) => onOpenScopeChat?.(key, id));
  openScope.current = (key: string, id: string) => onOpenScopeChat?.(key, id);
  const groups = showAll
    ? scopes.map((scope) => {
        const current = scope.key === currentKey;
        // The Project just left has no read of its own yet; the copy it was shown from fills in until one arrives.
        const state = scopeStates[scope.key] ?? (scope.link ? undefined : cachedProjectCopy(scope.key)?.state);
        const rows = current ? recents : state ? scopeChats(scope.key, state, chatOrder, marks) : [];
        const list = current
          ? {
              isActive: (item: SidebarRecent) => (activeId !== undefined ? item.id === activeId : item.label === selectedTitle),
              collapsed: false,
              actions: chatActions,
              showHints,
              onPick: pickChat,
              linkProjectId: !selectedLink && projectPath ? (registeredProjects.find((project) => project.path === projectPath)?.id ?? null) : null,
            }
          : { isActive: NEVER_ACTIVE, collapsed: false, actions: actionsFor(scope.key), showHints: false, onPick: pickerFor(scope.key), linkProjectId: null };
        return { scope, current, state, list, pinned: rows.filter((row) => row.pinned), rest: rows.filter((row) => !row.pinned) };
      })
    : [];
  const [closedScopes, setClosedScopes] = useState(readClosedScopes);
  const toggleScope = (key: string) =>
    setClosedScopes((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      window.localStorage.setItem(CLOSED_SCOPES_KEY, JSON.stringify(next));
      return next;
    });

  const forgetProject = (path: string) => {
    setRecentProjects((list) => list.filter((project) => project.path !== path));
    window.milagre?.forgetProject?.(path).then(
      (list) => {
        if (Array.isArray(list)) setRecentProjects(list);
      },
      () => {},
    );
  };

  // A Project's ⋯ rows: the four actions, and removing it from the list unless it's the open one. A Link gets its name copied.
  const scopeMenu = (scope: { key: string; name: string; link: NamedProjectLink | null }, current: boolean): ScopeMenuItem[] => {
    if (scope.link) return [{ key: "copy-name", label: "Copy Link name", icon: Copy01Icon, run: () => copy(scope.name) }];
    const actions: Record<ProjectMenuKey, Pick<ScopeMenuItem, "run" | "disabled">> = {
      reveal: { run: () => void window.milagre?.revealInFolder(scope.key).catch(() => {}) },
      "copy-path": { run: () => copy(scope.key) },
      "copy-name": { run: () => copy(scope.name) },
      settings: { run: () => onOpenProjectSettings?.(scope.key), disabled: !onOpenProjectSettings },
    };
    return [
      ...projectMenuActions(IS_MAC).map((item) => ({ key: item.key, label: item.label, icon: PROJECT_MENU_ICONS[item.key], ...actions[item.key] })),
      ...(current
        ? []
        : [{ key: "remove", label: "Remove from list", icon: Cancel01Icon, destructive: true, separatorBefore: true, run: () => forgetProject(scope.key) }]),
    ];
  };

  const placeWorkspaceMenu = () => {
    const rect = workspaceButtonRef.current?.getBoundingClientRect();
    if (!rect) return false;
    // Collapsed, the menu opens beside the rail instead of covering it.
    setWorkspacePosition(collapsed ? { top: rect.top, left: rect.right + 8 } : { top: rect.bottom + 6, left: rect.left });
    return true;
  };
  const openWorkspaceMenu = () => {
    if (placeWorkspaceMenu()) setWorkspaceOpen(true);
  };

  useDismiss(
    workspaceOpen,
    () => setWorkspaceOpen(false),
    (target) => !!target.closest("[data-workspace-trigger], [data-workspace-menu]"),
    placeWorkspaceMenu,
  );

  const collapse = () => {
    setCollapsed(true);
    setWorkspaceOpen(false);
  };

  // A manual toggle is the user's choice: the window width stops overriding it until the next crossing.
  const toggle = () => {
    autoCollapsed.current = false;
    if (collapsed) setCollapsed(false);
    else collapse();
  };

  useEffect(() => {
    const query = window.matchMedia(AUTO_COLLAPSE_QUERY);
    const follow = () => {
      if (query.matches) {
        setCollapsed((current) => {
          if (!current) autoCollapsed.current = true;
          return true;
        });
        setWorkspaceOpen(false);
      } else if (autoCollapsed.current) {
        autoCollapsed.current = false;
        setCollapsed(false);
      }
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  // ⌘B / Ctrl+B toggles the sidebar exactly like its collapse button.
  useEffect(() => {
    function handleToggle(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", handleToggle);
    return () => window.removeEventListener("keydown", handleToggle);
  }, [collapsed]);

  const saveWidth = (width: number) => {
    const next = clampSidebarWidth(width);
    setExpandedWidth(next);
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = expandedWidth;
    let latest = startWidth;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    const move = (moveEvent: PointerEvent) => {
      latest = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setExpandedWidth(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      setResizing(false);
      saveWidth(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const resizeWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") saveWidth(expandedWidth - step);
    else if (event.key === "ArrowRight") saveWidth(expandedWidth + step);
    else if (event.key === "Home") saveWidth(SIDEBAR_MIN_WIDTH);
    else if (event.key === "End") saveWidth(SIDEBAR_MAX_WIDTH);
    else return;
    event.preventDefault();
  };

  return (
    <div className={`relative flex min-h-0 shrink-0 flex-col ${fill ? "h-full" : "h-[600px]"} ${className}`}>
      <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} shortcut="⌘B" side="bottom" className="absolute left-[76px] top-[-46px] z-[60]">
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink [-webkit-app-region:no-drag]"
        >
          <span className="pointer-events-none flex items-center justify-center">
            <HugeIcon icon={collapsed ? SidebarRight01Icon : SidebarLeft01Icon} size={18} />
          </span>
        </button>
      </Tooltip>
      <aside
        data-sidebar-collapsed={collapsed}
        aria-label="Workspace navigation"
        className="relative flex min-h-0 shrink-0 overflow-hidden rounded-window bg-surface shadow-card transition-[width]"
        style={
          {
            width: collapsed ? SIDEBAR_MOTION.collapsedWidth : expandedWidth,
            flex: "1 1 0%",
            // Following the pointer while dragging; the eased width transition would make the edge lag behind it.
            transitionDuration: resizing ? "0ms" : `${SIDEBAR_MOTION.duration}ms`,
            transitionTimingFunction: SIDEBAR_MOTION.easing,
            "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
            "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
            "--sidebar-easing": SIDEBAR_MOTION.easing,
          } as CSSProperties
        }
      >
        <div className="flex min-h-0 w-full shrink-0 flex-col">
          {!sidebarAllProjects && (
            <div className="relative h-10 shrink-0">
              <button
                ref={workspaceButtonRef}
                data-workspace-trigger
                type="button"
                aria-expanded={workspaceOpen}
                aria-label={workspace.name}
                onClick={() => (workspaceOpen ? setWorkspaceOpen(false) : openWorkspaceMenu())}
                className="sidebar-workspace-control absolute left-2 top-1 flex h-8 w-[calc(100%-16px)] items-center rounded-[8px] px-2 text-left transition-[background-color,transform] duration-100 hover:bg-hover-2 active:scale-[0.99]"
              >
                <span className={`sidebar-logo relative flex ${selectedLink ? "h-5 w-9" : "size-5"} shrink-0 items-center justify-center text-ink`}>
                  {selectedLink ? (
                    <ProjectAvatarStack projects={selectedLink.projects} />
                  ) : (
                    <WorkspaceIcon src={workspace.image} fallback={<IconPopsicle2 size={18} />} />
                  )}
                  {/* Collapsed, the copy beside the logo hides, so the dot moves onto its corner. */}
                  {attentionPaths.length > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 -right-0.5 hidden size-2 rounded-full bg-orange ring-2 ring-surface in-data-[sidebar-collapsed=true]:block"
                    />
                  )}
                </span>
                <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">{workspace.name}</span>
                {selectedLink && <span className="sidebar-copy mr-1 text-[11px] text-ink-3">Link</span>}
                {attentionPaths.length > 0 && <AttentionDot className="sidebar-copy mr-1" />}
                <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
                  <IconChevronDownSmall size={16} />
                </span>
              </button>

              {workspaceOpen && (
                <WorkspaceMenu
                  selectedLink={selectedLink}
                  links={namedLinks}
                  registeredProjects={registeredProjects}
                  onSwitchLink={onSwitchLink}
                  onLinkProject={onLinkProject}
                  position={workspacePosition}
                  workspace={workspace}
                  projectPath={projectPath}
                  onOpenProjectSettings={onOpenProjectSettings}
                  projects={projects}
                  onSwitchProject={onSwitchProject}
                  onOpenProject={onOpenProject}
                  onForgetProject={forgetProject}
                  attentionPaths={attentionPaths}
                  onClose={() => setWorkspaceOpen(false)}
                />
              )}
            </div>
          )}
          <ScrollArea className={`sidebar-scroll flex-1 overflow-x-hidden ${sidebarAllProjects ? "pt-2" : ""}`}>
            {onOpenCanvas && (
              <div className="mb-2">
                <GlideGroup>
                  <RailButton icon={<HugeIcon icon={GitMergeIcon} size={16} />} label="Canvas" active={canvasActive} onClick={onOpenCanvas} />
                </GlideGroup>
              </div>
            )}
            {onOpenCommands && (
              <Tooltip label="Search commands, chats, and projects" className="mx-2 mb-3 w-[calc(100%-16px)]" side="bottom" shortcut={`${shortcutModifier}K`}>
                <button
                  type="button"
                  aria-label="Command palette"
                  aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"}
                  onClick={onOpenCommands}
                  className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-ink-3 hover:bg-hover-2 hover:text-ink ${collapsed ? "justify-center" : ""}`}
                >
                  <IconMagnifyingGlass size={16} />
                  {!collapsed && <span className={`min-w-0 flex-1 truncate ${showHints ? "pr-7" : ""}`}>Search commands…</span>}
                </button>
              </Tooltip>
            )}
            {showAll ? (
              <>
                {/* Pinned chats of every Project and Link sit on top, like the single-project sidebar; each group lists the rest. */}
                {groups.some((group) => group.pinned.length > 0) && (
                  <div data-all-pinned className="mb-2">
                    <p className="sidebar-copy mx-2 mb-1 h-8 pl-2 text-[12.5px] font-medium leading-8 text-ink-3">Pinned</p>
                    {groups
                      .filter((group) => group.pinned.length > 0)
                      .map((group) => (
                        <div key={group.scope.key} data-pinned-scope={group.scope.key}>
                          <ChatList recents={group.pinned} {...group.list} pinnedHeader={false} header={null} />
                        </div>
                      ))}
                  </div>
                )}
                {groups.map(({ scope, current, state, rest, pinned, list }, index) => {
                  const open = !closedScopes.includes(scope.key);
                  return (
                    <section key={scope.key} data-sidebar-scope={scope.key} data-current={current || undefined} aria-label={scope.name} className="mb-2">
                      {scope.link && !scopes[index - 1]?.link && (
                        <p className="mx-2 mt-1 mb-1 h-6 pl-2 text-[12.5px] font-medium leading-6 text-ink-3">Links</p>
                      )}
                      <ScopeHeader
                        name={scope.name}
                        icon={
                          scope.link ? (
                            <ProjectAvatarStack
                              projects={scope.link.projectIds.map(
                                (id) => registeredProjects.find((project) => project.id === id) ?? { path: "", name: "Project" },
                              )}
                            />
                          ) : (
                            <span className="flex size-5 items-center justify-center overflow-hidden rounded-[6px] bg-ink text-[10px] font-semibold text-surface">
                              <WorkspaceIcon src={current && !selectedLink ? workspace.image : scopeImage(scope.key)} fallback={scope.initial} />
                            </span>
                          )
                        }
                        open={open}
                        current={current}
                        attention={!current && attentionPaths.includes(scope.key)}
                        onToggle={() => toggleScope(scope.key)}
                        onNewChat={
                          current
                            ? () => {
                                if (activeTitle === undefined) setDemoActiveTitle(null);
                                onNewChat?.();
                              }
                            : () => onNewChatInScope?.(scope.key)
                        }
                        menu={scopeMenu(scope, current)}
                      />
                      {open &&
                        (rest.length > 0 ? (
                          <ChatList recents={rest} {...list} hintOffset={pinned.length} header={null} />
                        ) : pinned.length > 0 ? null : (
                          <p className="mx-2 h-8 pl-9 text-[13px] leading-8 text-ink-3">{state || current ? "No chats yet" : "Loading chats…"}</p>
                        ))}
                    </section>
                  );
                })}
              </>
            ) : (
              <ChatList
                recents={recents}
                isActive={(item) => (activeId !== undefined ? item.id === activeId : item.label === selectedTitle)}
                collapsed={collapsed}
                actions={chatActions}
                showHints={showHints}
                onPick={pickChat}
                linkProjectId={!selectedLink && projectPath ? (registeredProjects.find((project) => project.path === projectPath)?.id ?? null) : null}
                header={
                  <div className={`sidebar-copy mx-2 mb-1 flex h-8 items-center justify-between pl-2 ${collapsed ? "hidden" : ""}`}>
                    <span className="text-[12.5px] font-medium text-ink-3">Chats</span>
                    <Tooltip label="New chat" shortcut="⌘N" align="end">
                      <button
                        type="button"
                        aria-label="New chat"
                        onClick={() => {
                          if (activeTitle === undefined) setDemoActiveTitle(null);
                          onNewChat?.();
                        }}
                        className={CHATS_HEADER_BUTTON}
                      >
                        <IconPlusMedium size={16} />
                      </button>
                    </Tooltip>
                  </div>
                }
              />
            )}
          </ScrollArea>

          {usage && <div className={`mt-3 border-t border-line pt-1.5 ${collapsed ? "mx-auto w-8" : "mx-2 w-[calc(100%-16px)]"}`}>{usage}</div>}

          <div
            className={`flex border-t border-line py-1.5 ${usage ? "mt-1.5" : "mt-3"} ${collapsed ? "mx-auto w-8 flex-col-reverse items-center gap-1" : "mx-2 w-[calc(100%-16px)] items-center justify-between"}`}
          >
            <div className={collapsed ? "flex flex-col-reverse items-center gap-1" : "flex items-center gap-1"}>
              <Tooltip label="Add project" shortcut="⌘O">
                <button
                  type="button"
                  aria-label="Add project"
                  onClick={() => onOpenProject?.()}
                  className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}
                >
                  <IconFolderAdd size={17} />
                </button>
              </Tooltip>
              {sidebarAllProjects && onLinkProject && (
                <Tooltip label="Link projects">
                  <button
                    type="button"
                    aria-label="Link projects"
                    data-link-projects
                    onClick={onLinkProject}
                    className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}
                  >
                    <HugeIcon icon={Link04Icon} size={17} />
                  </button>
                </Tooltip>
              )}
            </div>
            <Tooltip label="Settings" shortcut="⌘," align={collapsed ? "start" : "end"}>
              <button type="button" aria-label="Settings" onClick={onOpenSettings} className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}>
                <IconSettingsGear1 size={17} />
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={expandedWidth}
          tabIndex={0}
          title="Drag to resize, double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={() => saveWidth(SIDEBAR_MIN_WIDTH)}
          onKeyDown={resizeWithKeys}
          className="group absolute bottom-0 right-[-6px] top-0 z-10 flex w-3 cursor-col-resize justify-center outline-none [-webkit-app-region:no-drag]"
        >
          <span
            className={`my-3 w-0.5 rounded-full transition-colors duration-150 group-hover:bg-line-strong group-focus-visible:bg-accent ${resizing ? "bg-line-strong" : "bg-transparent"}`}
          />
        </div>
      )}
    </div>
  );
});

/* ─────────────────────────────────────────────────────────
 * CHAT LIST
 * Pinned chats on top in the user's order, the rest below in
 * the list's own order. A row dragged between two rows pins,
 * reorders or unpins it; dropped on the middle third of another
 * row, it offers a Link between the two chats' Worktrees. The
 * keyboard does the same: Space picks the focused row up, the
 * arrows move it, Space drops it and Escape cancels.
 * ───────────────────────────────────────────────────────── */

/** A press that moves this far is a drag; less is still a click that opens the chat. */
const DRAG_THRESHOLD = 4;
const TOAST_MS = 6000;
const DROP_HINTS = { "same-worktree": "Same worktree: a Link joins two different Worktrees", linked: "Already linked" };

/** Where a dragged chat would land: next to or on a row, or (id null) in the empty Pinned section. */
type DropTarget = { id: string | null; zone: DropZone };
type ChatDrag = { id: string; target: DropTarget | null; keyboard: boolean };
type LinkAsk = { source: SidebarRecent; target: SidebarRecent; top: number; left: number };

const sameTarget = (a: DropTarget | null, b: DropTarget | null) => a?.id === b?.id && a?.zone === b?.zone;

function ChatList({
  recents,
  isActive,
  collapsed,
  actions,
  showHints,
  onPick,
  linkProjectId,
  header,
  pinnedHeader = true,
  hintOffset = 0,
}: {
  recents: SidebarRecent[];
  isActive: (item: SidebarRecent) => boolean;
  collapsed: boolean;
  actions: ChatRowActions;
  showHints: boolean;
  onPick: (item: SidebarRecent) => void;
  /** The open Project's id on the canvas; null when its chats can't be linked from here. */
  linkProjectId: string | null;
  /** The "Chats" header, between the pinned chats and the rest. */
  header: ReactNode;
  /** False when the caller shows one Pinned heading over several lists (the all-Projects sidebar). */
  pinnedHeader?: boolean;
  /** Where this list's ⌘1–9 hints start, when its chats follow others in the same Project. */
  hintOffset?: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ChatDrag | null>(null);
  const dragRef = useRef<ChatDrag | null>(null);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; left: number; undo?: () => void } | null>(null);
  const [linkAsk, setLinkAsk] = useState<LinkAsk | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refocus = useRef<string | null>(null);
  const canDrag = !collapsed && Boolean(actions.onPin);
  const pinned = recents.filter((item) => item.pinned);
  const rest = recents.filter((item) => !item.pinned);
  const byId = (id: string | null) => recents.find((item) => item.id === id);

  // Window listeners and memoized row actions call through this, so they always see the latest render.
  const live = useRef({ recents, actions, over, drop, finish, hit });
  live.current = { recents, actions, over, drop, finish, hit };

  const showToast = (text: string, undo?: () => void) => {
    const aside = listRef.current?.closest("aside")?.getBoundingClientRect();
    setToast({ text, undo, left: (aside?.right ?? 0) + 12 });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Pinning from the row menu and from a drag both land here, so either can be undone.
  const rowActions = useMemo<ChatRowActions>(
    () => ({
      ...actions,
      onPin:
        actions.onPin &&
        ((id, order) => {
          const now = live.current;
          const item = now.recents.find((row) => row.id === id);
          if (!item || !now.actions.onPin) return;
          const orders = now.recents.filter((row) => row.pinned && row.id !== id).map((row) => row.pinOrder ?? 0);
          const next = order === undefined ? pinOrderAt(orders, orders.length) : order;
          const previous = item.pinned ? (item.pinOrder ?? 0) : null;
          now.actions.onPin(id, next);
          if ((previous === null) !== (next === null)) showToast(next === null ? "Unpinned" : "Pinned", () => live.current.actions.onPin?.(id, previous));
        }),
    }),
    [actions],
  );

  const endpoint = (item: SidebarRecent) => ({ pinned: item.pinned, worktree: item.details?.path });
  const linkBetween = (a: SidebarRecent, b: SidebarRecent) =>
    links.find(
      (link) =>
        link.a.project_id === linkProjectId &&
        link.b.project_id === linkProjectId &&
        ((link.a.worktree_path === a.details?.path && link.b.worktree_path === b.details?.path) ||
          (link.a.worktree_path === b.details?.path && link.b.worktree_path === a.details?.path)),
    );

  function intentOf(current: ChatDrag): DropIntent {
    const source = byId(current.id);
    const target = current.target;
    if (!source || !target || target.id === current.id) return "none";
    const onto = target.id === null ? null : byId(target.id);
    if (onto === undefined || onto?.pending) return "none";
    if (target.zone === "on" && !(source.details?.path && onto?.details?.path)) return "none";
    return dropIntent(endpoint(source), onto && endpoint(onto), target.zone, Boolean(onto && linkBetween(source, onto)));
  }

  /** The pinned chats other than the dragged one, and the index the drop puts it at among them. */
  function pinSlot(current: ChatDrag) {
    const others = recents.filter((item) => item.pinned && item.id !== current.id);
    const target = current.target;
    const index = !target?.id ? 0 : others.findIndex((item) => item.id === target.id) + (target.zone === "after" ? 1 : 0);
    return { orders: others.map((item) => item.pinOrder ?? 0), index };
  }

  function describe(current: ChatDrag) {
    const intent = intentOf(current);
    if (typeof intent === "object") return DROP_HINTS[intent.invalid];
    if (intent === "link") return `On ${byId(current.target!.id)?.label}: create Link`;
    if (intent === "pin" || intent === "reorder") {
      const { orders, index } = pinSlot(current);
      return `Pinned, position ${index + 1} of ${orders.length + 1}`;
    }
    return intent === "unpin" ? "Chats: unpin" : "No change";
  }

  function setDragState(next: ChatDrag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  function begin(id: string, keyboard: boolean) {
    setDragState({ id, target: null, keyboard });
    document.documentElement.setAttribute("data-chat-drag", "");
    if (!keyboard) {
      // The press that started the drag would otherwise select the labels it moves over.
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
    }
    // Read as the drag starts, so "Already linked" follows Links drawn on the canvas since.
    if (linkProjectId)
      void window.milagre?.getCanvas?.().then(
        (snapshot) => setLinks(snapshot.links),
        () => {},
      );
    setAnnouncement(keyboard ? `Picked up ${byId(id)?.label}. Arrow keys move it, Space drops it, Escape cancels.` : "");
  }

  function finish() {
    setDragState(null);
    document.documentElement.removeAttribute("data-chat-drag");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function over(target: DropTarget | null) {
    const current = dragRef.current;
    if (!current || sameTarget(current.target, target)) return;
    const next = { ...current, target };
    setDragState(next);
    if (current.keyboard) setAnnouncement(target ? describe(next) : "");
  }

  function drop() {
    const current = dragRef.current;
    finish();
    if (!current) return;
    const intent = intentOf(current);
    if (current.keyboard) {
      refocus.current = current.id;
      window.setTimeout(() => {
        refocus.current = null;
      }, 1000);
      setAnnouncement(
        typeof intent === "object"
          ? DROP_HINTS[intent.invalid]
          : intent === "none"
            ? "Dropped, nothing changed"
            : intent === "link"
              ? ""
              : `Dropped. ${describe(current)}`,
      );
    }
    if (intent === "pin" || intent === "reorder") {
      const { orders, index } = pinSlot(current);
      rowActions.onPin?.(current.id, pinOrderAt(orders, index));
    } else if (intent === "unpin") rowActions.onPin?.(current.id, null);
    else if (intent === "link") askLink(byId(current.id)!, byId(current.target!.id)!);
  }

  /** The row or empty Pinned section under the pointer; between two rows it keeps the last one. */
  function hit(x: number, y: number): DropTarget | null {
    const list = listRef.current;
    const box = list?.getBoundingClientRect();
    if (!list || !box || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-chat-id], [data-pin-zone]");
    if (!element || !list.contains(element)) return dragRef.current?.target ?? null;
    if (element.hasAttribute("data-pin-zone")) return { id: null, zone: "before" };
    const rect = element.getBoundingClientRect();
    const at = (y - rect.top) / rect.height;
    const zone: DropZone = linkProjectId ? (at < 1 / 3 ? "before" : at > 2 / 3 ? "after" : "on") : at < 0.5 ? "before" : "after";
    return { id: element.dataset.chatId ?? null, zone };
  }

  function startPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDrag || event.button !== 0 || dragRef.current) return;
    const pressed = event.target as HTMLElement;
    const row = pressed.closest<HTMLElement>("[data-chat-id]");
    const id = row?.dataset.chatId;
    if (!id || pressed.closest("a, input, [aria-haspopup]") || byId(id)?.pending) return;
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    const move = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD) return;
        started = true;
        begin(id, false);
      }
      live.current.over(live.current.hit(moveEvent.clientX, moveEvent.clientY));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
    const end = () => {
      stop();
      if (!started) return;
      // The press still ends in a click; it was a drag, so that click doesn't open a chat.
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      live.current.drop();
    };
    const cancel = () => {
      stop();
      if (started) live.current.finish();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }

  // Escape cancels a pointer drag; the keyboard drag handles its own keys on the row.
  useEffect(() => {
    if (!drag || drag.keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      live.current.finish();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag?.id, drag?.keyboard]);

  /** Every place the keyboard can move a chat to, top to bottom. */
  function slots(id: string): DropTarget[] {
    const others = recents.filter((item) => item.id !== id && !item.pending);
    const pins = others.filter((item) => item.pinned);
    const around = (item: SidebarRecent): DropTarget[] =>
      linkProjectId
        ? [
            { id: item.id, zone: "before" },
            { id: item.id, zone: "on" },
          ]
        : [{ id: item.id, zone: "before" }];
    const top: DropTarget[] = pins.length
      ? [...pins.flatMap(around), { id: pins.at(-1)!.id, zone: "after" }]
      : byId(id)?.pinned
        ? []
        : [{ id: null, zone: "before" }];
    return [...top, ...others.filter((item) => !item.pinned).flatMap(around)];
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = dragRef.current;
    const pressed = event.target as HTMLElement;
    if (!current) {
      const id = pressed.closest<HTMLElement>("[data-chat-id]")?.dataset.chatId;
      if (event.key !== " " || !canDrag || !id || !pressed.matches("[data-row]") || byId(id)?.pending) return;
      event.preventDefault();
      begin(id, true);
      return;
    }
    if (!current.keyboard) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const all = slots(current.id);
      if (!all.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = all.findIndex((slot) => sameTarget(slot, current.target));
      over(all[index === -1 ? (step > 0 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, index + step))]);
    } else if (event.key === " ") {
      event.preventDefault();
      drop();
    } else if (event.key === "Escape") {
      // Consumed here, so Escape doesn't also stop the open chat's turn.
      event.preventDefault();
      finish();
      setAnnouncement("Cancelled");
    } else if (event.key === "Tab") finish();
  }

  // Space on a row picks it up instead of opening it; Enter still opens it.
  const keyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " && canDrag && (event.target as HTMLElement).matches("[data-row]")) event.preventDefault();
  };

  // The line or highlight follows the target row, measured once the Pinned drop area has shown up.
  const targetId = drag?.target?.id;
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = targetId ? list?.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(targetId)}"]`) : null;
    if (!list || !row) return setMark(null);
    const box = list.getBoundingClientRect(),
      rect = row.getBoundingClientRect();
    setMark({ top: rect.top - box.top, height: rect.height });
  }, [targetId, recents]);

  // A row moved by the keyboard comes back in its new place; focus goes back to it.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id || listRef.current?.contains(document.activeElement)) return;
    focusRow(id);
  }, [recents]);

  function focusRow(id: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"] [data-row]`)?.focus();
  }

  function askLink(source: SidebarRecent, target: SidebarRecent) {
    const row = listRef.current?.querySelector(`[data-chat-id="${CSS.escape(target.id)}"]`)?.getBoundingClientRect();
    const aside = listRef.current?.closest("aside")?.getBoundingClientRect();
    setLinkAsk({ source, target, top: Math.max(8, Math.min(row?.top ?? 8, window.innerHeight - 220)), left: (aside?.right ?? 0) + 8 });
  }

  // The same Link the canvas draws between two Worktrees; undo removes it again.
  async function createLink(ask: LinkAsk) {
    setLinkAsk(null);
    focusRow(ask.source.id);
    if (!linkProjectId || !ask.source.details?.path || !ask.target.details?.path) return;
    const a = { project_id: linkProjectId, worktree_path: ask.source.details.path };
    const b = { project_id: linkProjectId, worktree_path: ask.target.details.path };
    try {
      const next = await window.milagre.addLink(a, b);
      setLinks(next);
      const created = next.find(
        (link) =>
          (link.a.worktree_path === a.worktree_path && link.b.worktree_path === b.worktree_path) ||
          (link.a.worktree_path === b.worktree_path && link.b.worktree_path === a.worktree_path),
      );
      showToast(
        "Link created",
        created &&
          (() => void window.milagre.removeLink(created.id).then(setLinks, (error) => showToast(`Could not remove the Link: ${ipcErrorMessage(error)}`))),
      );
    } catch (error) {
      showToast(`Could not create the Link: ${ipcErrorMessage(error)}`);
    }
  }

  const intent = drag ? intentOf(drag) : "none";
  const row = (item: SidebarRecent, index: number) => (
    <ChatRow
      key={item.id}
      item={item}
      active={isActive(item)}
      collapsed={collapsed}
      actions={rowActions}
      shortcutHint={showHints && hintOffset + index < 9 ? `${shortcutModifier}${hintOffset + index + 1}` : undefined}
      onPick={onPick}
      dragging={drag?.id === item.id}
    />
  );

  return (
    <div ref={listRef} data-chat-list className="relative" onPointerDown={startPointer} onKeyDown={keyDown} onKeyUp={keyUp}>
      {pinnedHeader && (pinned.length > 0 || drag) && !collapsed && (
        <div className="sidebar-copy mx-2 mb-1 flex h-8 items-center pl-2">
          <span className="text-[12.5px] font-medium text-ink-3">Pinned</span>
        </div>
      )}
      {drag && pinned.length === 0 && !collapsed && (
        <div
          data-pin-zone
          className={`mx-2 mb-1 flex h-8 items-center justify-center rounded-[8px] border border-dashed text-[12.5px] ${drag.target?.id === null ? "border-accent bg-accent/10 text-accent-ink" : "border-line-strong text-ink-3"}`}
        >
          Drop here to pin
        </div>
      )}
      {pinned.length > 0 && (
        <div data-pinned-chats className="mb-2">
          <GlideGroup>{pinned.map(row)}</GlideGroup>
        </div>
      )}
      {collapsed && pinned.length > 0 && <div className="mx-auto mb-2 h-px w-5 bg-line" />}
      {header}
      <GlideGroup>{rest.map((item, index) => row(item, pinned.length + index))}</GlideGroup>

      {drag?.target?.id &&
        mark &&
        intent !== "none" &&
        (drag.target.zone === "on" ? (
          <div
            data-drop-target={typeof intent === "object" ? "invalid" : "link"}
            className={`pointer-events-none absolute inset-x-2 z-30 flex items-center justify-end rounded-[8px] pr-2 ring-2 ${typeof intent === "object" ? "bg-red/5 ring-red/60" : "bg-accent/10 text-accent ring-accent"}`}
            style={{ top: mark.top, height: mark.height }}
          >
            {typeof intent === "object" ? (
              <span className="absolute left-0 top-full z-40 mt-1 rounded-[6px] bg-surface px-2 py-1 text-[11.5px] text-red shadow-overlay">
                {DROP_HINTS[intent.invalid]}
              </span>
            ) : (
              <HugeIcon icon={Link04Icon} size={14} />
            )}
          </div>
        ) : (
          <div
            data-drop-line
            className="pointer-events-none absolute inset-x-3 z-30 h-0.5 -translate-y-1/2 rounded-full bg-accent"
            style={{ top: drag.target.zone === "before" ? mark.top : mark.top + mark.height }}
          />
        ))}

      <div aria-live="assertive" className="sr-only">
        {announcement}
      </div>
      {linkAsk && (
        <LinkPopover
          ask={linkAsk}
          onConfirm={() => void createLink(linkAsk)}
          onCancel={() => {
            setLinkAsk(null);
            focusRow(linkAsk.source.id);
          }}
        />
      )}
      {toast &&
        createPortal(
          <div
            role="status"
            data-chat-toast
            className="fixed bottom-4 z-[80] flex items-center gap-3 rounded-[10px] bg-surface px-3 py-2 text-[13px] text-ink shadow-overlay"
            style={{ left: toast.left, animation: "fade-up 200ms cubic-bezier(0.23,1,0.32,1) both" }}
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                type="button"
                data-chat-toast-undo
                onClick={() => {
                  setToast(null);
                  toast.undo?.();
                }}
                className="font-medium text-accent-ink hover:underline"
              >
                Undo
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Asks before a dropped chat creates a Link; nothing is created until Create Link. */
function LinkPopover({ ask, onConfirm, onCancel }: { ask: LinkAsk; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-link-confirm]")?.focus();
  }, []);
  useDismiss(true, onCancel, (target) => !!ref.current?.contains(target));
  const side = (item: SidebarRecent) => item.details?.branch ?? item.label;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Create Link"
      data-link-popover
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
      className="fixed z-[70] w-72 rounded-[12px] bg-surface p-3 shadow-overlay"
      style={{ top: ask.top, left: ask.left, animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top left" }}
    >
      <p className="text-[13.5px] font-semibold text-ink">Link these Worktrees?</p>
      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2">
        <span className="truncate">{side(ask.source)}</span>
        <span className="shrink-0 text-ink-3">
          <HugeIcon icon={Link04Icon} size={13} />
        </span>
        <span className="truncate">{side(ask.target)}</span>
      </p>
      <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
        Every Chat on either side can read the other side and make Delegations to it, so “{ask.source.label}” can ask “{ask.target.label}” for changes.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-[8px] px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hover-2">
          Cancel
        </button>
        <button type="button" data-link-confirm onClick={onConfirm} className="rounded-[8px] bg-ink px-3 py-1.5 text-[13px] font-medium text-surface">
          Create Link
        </button>
      </div>
    </div>,
    document.body,
  );
}
