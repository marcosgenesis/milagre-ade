"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  FolderAddIcon,
  FolderOpenIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SparklesIcon,
  StopCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import GlideMenu from "@/components/primitives/GlideMenu";
import Tooltip from "@/components/primitives/Tooltip";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { projectMenuActions, type ProjectMenuKey } from "@/lib/reveal";
import { projectRows, sameTarget, switchQuestion, switchStep, type ProjectRow, type RecentProject, type SwitchTarget } from "@/lib/project-list";
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
  workspaceName?: string;
  workspaceImage?: string | null;
  onOpenProject?: () => void;
  activeTitle?: string | null;
  /** Controlled selection of a recent by id; takes precedence over title matching. */
  activeId?: string | null;
  className?: string;
  fill?: boolean;
  onNewChat?: () => void;
  onPick?: (id: string, label: string, prompt?: string) => void;
  onOpenSettings?: () => void;
  /** The project folder, for the project menu's reveal and copy path. */
  projectPath?: string;
  /** Opens a project from the recent list in the project menu. */
  onSwitchProject?: (path: string) => void;
  /** The chat with a turn running in the open project: while there is one, switching projects asks first. */
  runningChat?: string | null;
  /** Each change opens the project menu asking about "Open project…" (⌘O while a turn runs). */
  askToOpenProject?: number;
  onOpenProjectSettings?: () => void;
  recents?: SidebarRecent[];
  /** What the chat rows' menu can do; an action left out is shown disabled. */
  chatActions?: ChatRowActions;
  /** Plan usage, shown above the footer buttons in both the expanded and collapsed sidebar. */
  usage?: ReactNode;
  variant?: string;
};

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  // A 32px control with 6px of space on each side.
  collapsedWidth: 44,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* ─────────────────────────────────────────────────────────
 * CHAT SEARCH STORYBOARD
 *
 *   0ms   search is triggered; Chats label begins fading
 *   0ms   field grows right → left from the search control
 * 180ms   field fills the row; cursor is focused and ready
 * ───────────────────────────────────────────────────────── */
const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

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
  runningChat,
  initialAsk,
  onSwitchProject,
  onOpenProject,
  onForgetProject,
}: {
  position: { top: number; left: number };
  onClose: () => void;
  workspace: { name: string; monogram: string; image?: string | null };
  projectPath?: string;
  onOpenProjectSettings?: () => void;
  projects: ProjectRow[];
  runningChat: string | null;
  /** What the menu opens asking about, if anything. */
  initialAsk: SwitchTarget | null;
  onSwitchProject?: (path: string) => void;
  onOpenProject?: () => void;
  onForgetProject?: (path: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // While a turn runs, the project (or "Open project…") clicked first: it asks before it goes.
  const [asking, setAsking] = useState<SwitchTarget | null>(initialAsk);
  const imageOf = useProjectImages(projects.filter((row) => !row.current).map((row) => row.path));
  useLayoutEffect(() => {
    const menu = menuRef.current;
    // The question's confirm takes focus when it shows; otherwise the first row does.
    (menu?.querySelector<HTMLElement>("[data-switch-confirm]") ?? menu?.querySelector<HTMLElement>("[data-menu-row]:not(:disabled)"))?.focus();
  }, [asking]);

  const go = (target: SwitchTarget) => {
    onClose();
    if (target.kind === "open") onOpenProject?.();
    else onSwitchProject?.(target.path);
  };
  const choose = (target: SwitchTarget) => {
    const step = switchStep(asking, target, runningChat);
    if ("go" in step) go(step.go);
    else setAsking(step.ask);
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
  const isAsking = (target: SwitchTarget) => asking !== null && runningChat !== null && sameTarget(asking, target);
  const question = (target: SwitchTarget) => isAsking(target) && runningChat !== null && (
    <div data-switch-question>
      <p className="px-2 pb-1 pt-1.5 text-[12px] leading-snug text-ink-3">{switchQuestion(runningChat)}</p>
      <button
        data-menu-row
        data-switch-confirm
        role="menuitem"
        type="button"
        onClick={() => go(target)}
        className="relative z-10 flex h-8 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-red outline-none focus-visible:bg-hover-2"
      >
        <span className="flex size-5 shrink-0 items-center justify-center"><HugeIcon icon={StopCircleIcon} size={16} /></span>
        <span className="min-w-0 flex-1 truncate text-[13.5px]">Stop and switch</span>
      </button>
    </div>
  );

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
      className="fixed z-50 max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-[14px] bg-surface p-1.5 shadow-overlay"
      style={{
        top: position.top,
        left: position.left,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "top left",
      }}
    >
      <GlideMenu className="flex flex-col gap-px" rowSelector="[data-menu-row]:not(:disabled)" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
        {projectMenuActions(IS_MAC).map((item) => (
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
        {projects.map((row) => {
          const target: SwitchTarget = { kind: "project", path: row.path };
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
                onClick={() => (row.current ? onClose() : choose(target))}
                onKeyDown={(event) => {
                  if (row.current || (event.key !== "Delete" && event.key !== "Backspace")) return;
                  event.preventDefault();
                  forget(row.path, event.currentTarget.closest("[data-project-item]"));
                }}
                className={`relative z-10 flex h-10 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2 ${isAsking(target) ? "bg-hover-2" : ""}`}
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
              {question(target)}
            </div>
          );
        })}
        <div className="my-1 h-px bg-line" />
        <button
          data-menu-row
          data-open-project
          role="menuitem"
          type="button"
          onClick={() => choose({ kind: "open" })}
          className={`relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left outline-none focus-visible:bg-hover-2 ${isAsking({ kind: "open" }) ? "bg-hover-2" : ""}`}
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2"><IconPlusMedium size={16} /></span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">Open project…</span>
        </button>
        {question({ kind: "open" })}
      </GlideMenu>
    </div>,
    document.body,
  );
}

export default function SidebarNav({
  workspaceName = WORKSPACE.name,
  workspaceImage,
  onOpenProject,
  activeTitle,
  activeId,
  className = "",
  fill = false,
  onNewChat,
  onPick,
  onOpenSettings,
  projectPath,
  onOpenProjectSettings,
  onSwitchProject,
  runningChat = null,
  askToOpenProject = 0,
  recents = DEFAULT_RECENTS,
  chatActions = {},
  usage,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [workspaceAsk, setWorkspaceAsk] = useState<SwitchTarget | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedTitle = activeTitle === undefined ? demoActiveTitle : activeTitle;
  const visibleRecents = recents.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const workspace = { name: workspaceName, image: workspaceImage, monogram: workspaceName.trim().slice(0, 1).toUpperCase() || "M" };
  const projects = projectPath ? projectRows({ recent: recentProjects, currentPath: projectPath, currentName: workspaceName }) : [];

  // Read on mount and again each time the menu opens, so a folder that's gone drops out.
  useEffect(() => {
    if (!projectPath) return;
    let live = true;
    window.milagre?.listRecentProjects?.().then((list) => { if (live) setRecentProjects(list); }, () => {});
    return () => { live = false; };
  }, [projectPath, workspaceOpen]);

  const forgetProject = (path: string) => {
    setRecentProjects((list) => list.filter((project) => project.path !== path));
    window.milagre?.forgetProject?.(path).then(setRecentProjects, () => {});
  };

  const openWorkspaceMenu = (ask: SwitchTarget | null = null) => {
    const button = workspaceButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    // Collapsed, the menu opens beside the rail instead of covering it.
    setWorkspacePosition(collapsed ? { top: rect.top, left: rect.right + 8 } : { top: rect.bottom + 6, left: rect.left });
    setWorkspaceAsk(ask);
    setWorkspaceOpen(true);
  };

  // ⌘O while a turn runs: the menu opens with "Open project…" asking first.
  const seenAsk = useRef(askToOpenProject);
  useEffect(() => {
    if (askToOpenProject === seenAsk.current) return;
    seenAsk.current = askToOpenProject;
    openWorkspaceMenu({ kind: "open" });
  }, [askToOpenProject]);

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

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const collapse = () => {
    setCollapsed(true);
    setWorkspaceOpen(false);
    setSearchOpen(false);
    setQuery("");
  };

  // ⌘B / Ctrl+B toggles the sidebar exactly like its collapse button.
  useEffect(() => {
    function handleToggle(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      if (collapsed) setCollapsed(false);
      else collapse();
    }
    window.addEventListener("keydown", handleToggle);
    return () => window.removeEventListener("keydown", handleToggle);
  }, [collapsed]);

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
          onClick={() => collapsed ? setCollapsed(false) : collapse()}
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
          width: collapsed ? SIDEBAR_MOTION.collapsedWidth : SIDEBAR_MOTION.expandedWidth,
          flex: "1 1 0%",
          transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
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
            <span className="sidebar-logo flex size-5 shrink-0 items-center justify-center text-ink">
              <WorkspaceIcon src={workspace.image} fallback={<IconPopsicle2 size={18} />} />
            </span>
            <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">
              {workspace.name}
            </span>
            <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
              <IconChevronDownSmall size={16} />
            </span>
          </button>

          {workspaceOpen && (
            <WorkspaceMenu
              position={workspacePosition}
              workspace={workspace}
              projectPath={projectPath}
              onOpenProjectSettings={onOpenProjectSettings}
              projects={projects}
              runningChat={runningChat}
              initialAsk={workspaceAsk}
              onSwitchProject={onSwitchProject}
              onOpenProject={onOpenProject}
              onForgetProject={forgetProject}
              onClose={() => setWorkspaceOpen(false)}
            />
          )}

        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`sidebar-copy relative mx-2 mb-1 h-8 ${collapsed ? "hidden" : ""}`}>
            <div
              aria-hidden={searchOpen}
              className={`absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-ink-3 transition-[opacity,transform] ${searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100"}`}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`, transitionTimingFunction: CHAT_SEARCH_MOTION.easing }}
            >
              <span>Chats</span>
            </div>

            <div
              className={`absolute right-0 top-0 z-10 flex transition-opacity ${searchOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms` }}
            >
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
              <button type="button" aria-label="Search chats" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)} className={CHATS_HEADER_BUTTON}>
                <IconMagnifyingGlass size={16} />
              </button>
            </div>

            <div
              className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
              style={{
                width: searchOpen ? "100%" : CHAT_SEARCH_MOTION.closedWidth,
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
            >
              <span className="ml-2 flex shrink-0 items-center justify-center">
                <IconMagnifyingGlass size={15} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSearchOpen(false);
                    setQuery("");
                  }
                }}
                placeholder="Search chats"
                aria-label="Search chat history"
                className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label="Close chat search"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <IconCrossSmall size={16} />
              </button>
            </div>
          </div>

          <GlideGroup>
            {visibleRecents.map((item) => (
              <ChatRow
                key={item.id}
                item={item}
                active={activeId !== undefined ? item.id === activeId : item.label === selectedTitle}
                collapsed={collapsed}
                actions={chatActions}
                onPick={() => {
                  if (activeTitle === undefined) setDemoActiveTitle(item.label);
                  onPick?.(item.id, item.label, item.prompt);
                }}
              />
            ))}
            {query && visibleRecents.length === 0 && (
              <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">No chats found</div>
            )}
          </GlideGroup>
        </div>

        {usage && (
          <div className={`mt-3 border-t border-line pt-1.5 ${collapsed ? "mx-auto w-8" : "mx-2 w-[calc(100%-16px)]"}`}>
            {usage}
          </div>
        )}

        <div className={`flex border-t border-line py-1.5 ${usage ? "mt-1.5" : "mt-3"} ${collapsed ? "mx-auto w-8 flex-col-reverse items-center gap-1" : "mx-2 w-[calc(100%-16px)] items-center justify-between"}`}>
          <Tooltip label="Add project" shortcut="⌘O">
            <button type="button" aria-label="Add project" onClick={() => (runningChat ? openWorkspaceMenu({ kind: "open" }) : onOpenProject?.())} className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}>
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
    </div>
  );
}
