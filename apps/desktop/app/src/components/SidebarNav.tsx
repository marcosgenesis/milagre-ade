import type { NamedProjectLink } from '@milagre/shared/model';
import { ProjectAvatarStack } from './ProjectAvatarStack';
"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
import { projectRows, type ProjectRow, type RecentProject } from "@/lib/project-list";
import { ChatRow, type ChatRowActions, type SidebarRecent } from "./sidebar/ChatRow";

export type { SidebarRecent } from "./sidebar/ChatRow";

type HugeIconProps = { size?: number; className?: string };
type HugeIconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function HugeIcon({ icon, size = 16, className }: HugeIconProps & { icon: HugeIconData }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" className={className} />;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
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
 * Shared by the design-system preview and the harness shell:
 * compact workspace switcher, primary navigation, searchable
 * chat history, and a collapse that preserves icon alignment.
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
  onOpenProjectSettings?: () => void;
  recents?: SidebarRecent[];
  /** What the chat rows' menu can do; an action left out is shown disabled. */
  chatActions?: ChatRowActions;
  /** Plan usage, shown above the footer buttons in both the expanded and collapsed sidebar. */
  usage?: ReactNode;
  variant?: string;
};

const NO_CHAT_ACTIONS: ChatRowActions = {};

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

const CHATS_HEADER_BUTTON =
  "flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]";

const BOTTOM_BAR_BUTTON =
  "flex items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]";

export function GlideGroup({ children }: { children: ReactNode }) {
  return (
    <GlideMenu
      rowSelector="[data-row]"
      highlightClassName="sidebar-glide-highlight rounded-[7px] bg-hover-2"
      className="group/glide flex flex-col gap-px"
    >
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
      <span className={`flex size-5 shrink-0 items-center justify-center ${active ? "text-ink" : "text-ink-2"}`}>
        {icon}
      </span>
      <span className={`sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
        {label}
      </span>
      {count && (
        <span className="sidebar-copy mr-2 shrink-0 text-[12px] font-medium tabular-nums text-ink-3">
          {count}
        </span>
      )}
    </button>
  );
}

// The other listed projects' avatars, looked up once per run: the lookup can ask GitHub.
const projectImages = new Map<string, string | null>();

function useProjectImages(paths: string[]) {
  const [, setLoaded] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    let live = true;
    for (const path of paths) {
      if (projectImages.has(path)) continue;
      projectImages.set(path, null);
      window.milagre?.getProjectImage(path).then((src) => {
        projectImages.set(path, src);
        if (live) setLoaded((count) => count + 1);
      }, () => {});
    }
    return () => { live = false; };
  }, [key]);
  return (path: string) => projectImages.get(path) ?? null;
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
  selectedLink, links, registeredProjects, onSwitchLink, onLinkProject,
}: {
  position: { top: number; left: number };
  onClose: () => void;
  workspace: { name: string; monogram: string; image?: string | null };
  projectPath?: string;
  onOpenProjectSettings?: () => void;
  projects: ProjectRow[];
  onSwitchProject?: (path: string) => void;
  onOpenProject?: () => void;
  onForgetProject?: (path: string) => void;
  selectedLink?: SidebarNavProps['selectedLink'];
  links: NamedProjectLink[];
  registeredProjects: Array<{ id: string; path: string; name: string }>;
  onSwitchLink?: (id: string) => void;
  onLinkProject?: () => void;
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
    settings: { run: () => onOpenProjectSettings?.(), disabled: !onOpenProjectSettings },
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
        {!selectedLink && projectMenuActions(IS_MAC).map((item) => (
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
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2"><HugeIcon icon={PROJECT_MENU_ICONS[item.key]} size={16} /></span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{item.label}</span>
          </button>
        ))}
        <div className="my-1 h-px bg-line" />
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
                <span className={`min-w-0 flex-1 truncate text-[13.5px] text-ink ${row.current ? "font-medium" : "group-hover/project:pr-6"}`}>{row.name}</span>
                {row.current && <span className="shrink-0 text-ink"><IconCheckmark1Small size={18} /></span>}
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
        {links.length > 0 && <>
          <div className="my-1 h-px bg-line" />
          <p className="px-2 py-1 text-[11px] font-medium text-ink-3">Links</p>
          {links.map(link => <button key={link.id} data-menu-row data-link-row={link.id} type="button" role="menuitemradio" aria-checked={selectedLink?.id === link.id} onClick={() => go(() => onSwitchLink?.(link.id))} className="relative z-10 flex min-h-10 items-center gap-2 rounded-[8px] px-2 py-1 text-left outline-none focus-visible:bg-hover-2">
            <ProjectAvatarStack projects={link.projectIds.map(id => registeredProjects.find(project => project.id === id) ?? { path: '', name: 'Project' })} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] text-ink">{link.name}</span><span className="block text-[11px] text-ink-3">{link.projectIds.length} Projects</span></span>
            {selectedLink?.id === link.id && <IconCheckmark1Small size={18} />}
          </button>)}
        </>}
        <div className="my-1 h-px bg-line" />
        <button
          data-menu-row
          data-open-project
          role="menuitem"
          type="button"
          onClick={() => go(() => onOpenProject?.())}
          className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2"
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2"><IconPlusMedium size={16} /></span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">Open project…</span>
        </button>
        {onLinkProject && <button data-menu-row type="button" role="menuitem" onClick={() => go(onLinkProject)} className="relative z-10 flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2"><span className="flex size-5 items-center justify-center text-ink-2"><IconPlusMedium size={16} /></span><span className="text-[13.5px]">Link projects…</span></button>}
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
  selectedLink, onSwitchLink, onLinkProject,
  onOpenProject,
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
  onSwitchProject,
  recents = DEFAULT_RECENTS,
  chatActions = NO_CHAT_ACTIONS,
  usage,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(AUTO_COLLAPSE_QUERY).matches);
  // True only while the sidebar is collapsed because the window got narrow, so widening it brings the sidebar back.
  const autoCollapsed = useRef(collapsed);
  const [expandedWidth, setExpandedWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [namedLinks, setNamedLinks] = useState<NamedProjectLink[]>([]);
  const [registeredProjects, setRegisteredProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const showHints = useShortcutHints() && hintsEnabled && !workspaceOpen;
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);

  const selectedTitle = activeTitle === undefined ? demoActiveTitle : activeTitle;
  // One identity for every row, so memo(ChatRow) skips when the sidebar re-renders.
  const pickChat = useCallback((item: SidebarRecent) => {
    if (activeTitle === undefined) setDemoActiveTitle(item.label);
    onPick?.(item.id, item.label, item.prompt);
  }, [activeTitle, onPick]);
  const workspace = { name: workspaceName, image: workspaceImage, monogram: workspaceName.trim().slice(0, 1).toUpperCase() || "M" };
  const projects = projectPath ? projectRows({ recent: recentProjects, currentPath: projectPath, currentName: workspaceName }) : recentProjects.map(project => ({ ...project, initial: project.name.slice(0, 1).toUpperCase(), current: false }));

  // Read on mount and again each time the menu opens, so a folder that's gone drops out.
  useEffect(() => {
    let live = true;
    window.milagre?.listRecentProjects?.().then((list) => { if (live) setRecentProjects(Array.isArray(list) ? list : []); }, () => {});
    void window.milagre?.listNamedLinks?.().then(links => { if (live) setNamedLinks(links); }).catch(() => {});
    void window.milagre?.listProjects?.().then(projects => { if (live) setRegisteredProjects(projects); }).catch(() => {});
    return () => { live = false; };
  }, [projectPath, workspaceOpen, selectedLink?.id]);

  const forgetProject = (path: string) => {
    setRecentProjects((list) => list.filter((project) => project.path !== path));
    window.milagre?.forgetProject?.(path).then((list) => { if (Array.isArray(list)) setRecentProjects(list); }, () => {});
  };

  const openWorkspaceMenu = () => {
    const button = workspaceButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    // Collapsed, the menu opens beside the rail instead of covering it.
    setWorkspacePosition(collapsed ? { top: rect.top, left: rect.right + 8 } : { top: rect.bottom + 6, left: rect.left });
    setWorkspaceOpen(true);
  };

  useEffect(() => {
    if (!workspaceOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-workspace-trigger]") && !target.closest("[data-workspace-menu]")) {
        setWorkspaceOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [workspaceOpen]);

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
      <Tooltip
        label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        shortcut="⌘B"
        side="bottom"
        className="absolute left-[76px] top-[-46px] z-[60]"
      >
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
        style={{
          width: collapsed ? SIDEBAR_MOTION.collapsedWidth : expandedWidth,
          flex: "1 1 0%",
          // Following the pointer while dragging; the eased width transition would make the edge lag behind it.
          transitionDuration: resizing ? "0ms" : `${SIDEBAR_MOTION.duration}ms`,
          transitionTimingFunction: SIDEBAR_MOTION.easing,
          "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
          "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
          "--sidebar-easing": SIDEBAR_MOTION.easing,
        } as CSSProperties}
      >
      <div className="flex min-h-0 w-full shrink-0 flex-col">
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
            <span className={`sidebar-logo flex ${selectedLink ? "h-5 w-9" : "size-5"} shrink-0 items-center justify-center text-ink`}>
              {selectedLink ? <ProjectAvatarStack projects={selectedLink.projects} /> : <WorkspaceIcon src={workspace.image} fallback={<IconPopsicle2 size={18} />} />}
            </span>
            <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">
              {workspace.name}
            </span>
            {selectedLink && <span className="sidebar-copy mr-1 text-[11px] text-ink-3">Link</span>}
            <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
              <IconChevronDownSmall size={16} />
            </span>
          </button>

          {workspaceOpen && (
            <WorkspaceMenu
              selectedLink={selectedLink} links={namedLinks} registeredProjects={registeredProjects} onSwitchLink={onSwitchLink} onLinkProject={onLinkProject}
              position={workspacePosition}
              workspace={workspace}
              projectPath={projectPath}
              onOpenProjectSettings={onOpenProjectSettings}
              projects={projects}
              onSwitchProject={onSwitchProject}
              onOpenProject={onOpenProject}
              onForgetProject={forgetProject}
              onClose={() => setWorkspaceOpen(false)}
            />
          )}

        </div>

        <ScrollArea className="sidebar-scroll flex-1 overflow-x-hidden">
          {onOpenCanvas && <div className="mb-2"><GlideGroup><RailButton icon={<HugeIcon icon={GitMergeIcon} size={16} />} label="Canvas" active={canvasActive} onClick={onOpenCanvas} /></GlideGroup></div>}
          {onOpenCommands && (
            <Tooltip label="Search commands, chats, and projects" className="mx-2 mb-3 w-[calc(100%-16px)]" side="bottom" shortcut={`${shortcutModifier}K`}>
              <button type="button" aria-label="Command palette" aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"} onClick={onOpenCommands}
                className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-ink-3 hover:bg-hover-2 hover:text-ink ${collapsed ? "justify-center" : ""}`}>
                <IconMagnifyingGlass size={16} />
                {!collapsed && <span className={`min-w-0 flex-1 truncate ${showHints ? "pr-7" : ""}`}>Search commands…</span>}
              </button>
            </Tooltip>
          )}
          <div className={`sidebar-copy mx-2 mb-1 flex h-8 items-center justify-between pl-2 ${collapsed ? "hidden" : ""}`}>
            <span className="text-[12.5px] font-medium text-ink-3">Chats</span>
            <Tooltip label="New chat" shortcut="⌘N" align="end">
              <button type="button" aria-label="New chat" onClick={() => {
                if (activeTitle === undefined) setDemoActiveTitle(null);
                onNewChat?.();
              }} className={CHATS_HEADER_BUTTON}>
                <IconPlusMedium size={16} />
              </button>
            </Tooltip>
          </div>

          <GlideGroup>
            {recents.map((item, index) => (
              <ChatRow
                key={item.id}
                item={item}
                active={activeId !== undefined ? item.id === activeId : item.label === selectedTitle}
                collapsed={collapsed}
                actions={chatActions}
                shortcutHint={showHints && index < 9 ? `${shortcutModifier}${index + 1}` : undefined}
                onPick={pickChat}
              />
            ))}
          </GlideGroup>
        </ScrollArea>

        {usage && (
          <div className={`mt-3 border-t border-line pt-1.5 ${collapsed ? "mx-auto w-8" : "mx-2 w-[calc(100%-16px)]"}`}>
            {usage}
          </div>
        )}

        <div className={`flex border-t border-line py-1.5 ${usage ? "mt-1.5" : "mt-3"} ${collapsed ? "mx-auto w-8 flex-col-reverse items-center gap-1" : "mx-2 w-[calc(100%-16px)] items-center justify-between"}`}>
          <Tooltip label="Add project" shortcut="⌘O">
            <button type="button" aria-label="Add project" onClick={() => onOpenProject?.()} className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}>
              <IconFolderAdd size={17} />
            </button>
          </Tooltip>
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
          <span className={`my-3 w-0.5 rounded-full transition-colors duration-150 group-hover:bg-line-strong group-focus-visible:bg-accent ${resizing ? "bg-line-strong" : "bg-transparent"}`} />
        </div>
      )}
    </div>
  );
});
