"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  FolderAddIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SparklesIcon,
  Tick02Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import GlideMenu from "@/components/primitives/GlideMenu";
import Tooltip from "@/components/primitives/Tooltip";
import { WorkspaceIcon } from "./WorkspaceIcon";

type HugeIconProps = { size?: number; className?: string };
type HugeIconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function HugeIcon({ icon, size = 16, className }: HugeIconProps & { icon: HugeIconData }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" className={className} />;
}

const IconArrowBoxLeft = (props: HugeIconProps) => <HugeIcon icon={ArrowLeft01Icon} {...props} />;
const IconCheckmark1Small = (props: HugeIconProps) => <HugeIcon icon={Tick02Icon} {...props} />;
const IconChevronDownSmall = (props: HugeIconProps) => <HugeIcon icon={ArrowDown01Icon} {...props} />;
const IconCrossSmall = (props: HugeIconProps) => <HugeIcon icon={Cancel01Icon} {...props} />;
const IconFolderAdd = (props: HugeIconProps) => <HugeIcon icon={FolderAddIcon} {...props} />;
const IconMagnifyingGlass = (props: HugeIconProps) => <HugeIcon icon={Search01Icon} {...props} />;
const IconPlusMedium = (props: HugeIconProps) => <HugeIcon icon={Add01Icon} {...props} />;
const IconPopsicle2 = (props: HugeIconProps) => <HugeIcon icon={SparklesIcon} {...props} />;
const IconSettingsGear1 = (props: HugeIconProps) => <HugeIcon icon={Settings01Icon} {...props} />;
const IconUserAdd = (props: HugeIconProps) => <HugeIcon icon={UserAdd01Icon} {...props} />;

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * Shared by the design-system preview and the harness shell:
 * compact workspace switcher, primary navigation, searchable
 * chat history, and a collapse that preserves icon alignment.
 * ───────────────────────────────────────────────────────── */

const WORKSPACE = { key: "creamery", name: "Creamery Ops", monogram: "C" };

export type SidebarRecent = {
  id: string;
  label: string;
  prompt?: string;
  /** The chat waits on an approval from the user. */
  waiting?: boolean;
};

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

function recentInitials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

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
  recents?: SidebarRecent[];
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

function WorkspaceMenu({
  position,
  onClose,
  workspace,
}: {
  position: { top: number; left: number };
  onClose: () => void;
  workspace: { name: string; monogram: string; image?: string | null };
}) {
  return createPortal(
    <div
      data-workspace-menu
      className="fixed z-50 w-64 rounded-[14px] bg-surface p-1.5 shadow-overlay"
      style={{
        top: position.top,
        left: position.left,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "top left",
      }}
    >
      <GlideMenu className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
        <button
          data-menu-row
          type="button"
          onClick={onClose}
          className="relative z-10 flex h-10 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-semibold text-surface">
            <WorkspaceIcon src={workspace.image} fallback={workspace.monogram} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{workspace.name}</span>
          <span className="shrink-0 text-ink"><IconCheckmark1Small size={18} /></span>
        </button>
        <div className="my-1 h-px bg-line" />
        {[
          { label: "New workspace", icon: <IconPlusMedium size={16} /> },
          { label: "Workspace settings", icon: <IconSettingsGear1 size={16} /> },
          { label: "Invite team members", icon: <IconUserAdd size={16} /> },
        ].map((item) => (
          <button
            key={item.label}
            data-menu-row
            type="button"
            onClick={onClose}
            className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{item.label}</span>
          </button>
        ))}
        <div className="my-1 h-px bg-line" />
        <button
          data-menu-row
          type="button"
          onClick={onClose}
          className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2"><IconArrowBoxLeft size={16} /></span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">Sign out</span>
        </button>
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
  recents = DEFAULT_RECENTS,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedTitle = activeTitle === undefined ? demoActiveTitle : activeTitle;
  const visibleRecents = recents.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const workspace = { name: workspaceName, image: workspaceImage, monogram: workspaceName.trim().slice(0, 1).toUpperCase() || "M" };

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
            onClick={() => {
              if (!workspaceOpen && workspaceButtonRef.current) {
                const rect = workspaceButtonRef.current.getBoundingClientRect();
                setWorkspacePosition({ top: rect.bottom + 6, left: rect.left });
              }
              setWorkspaceOpen((open) => !open);
            }}
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

          {workspaceOpen && <WorkspaceMenu position={workspacePosition} workspace={workspace} onClose={() => setWorkspaceOpen(false)} />}

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
            {visibleRecents.map((item) => {
              const active = activeId !== undefined ? item.id === activeId : item.label === selectedTitle;
              return (
                <button
                  key={item.id}
                  data-row
                  type="button"
                  title={item.label}
                  onClick={() => {
                    if (activeTitle === undefined) setDemoActiveTitle(item.label);
                    onPick?.(item.id, item.label, item.prompt);
                  }}
                  className={`sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] px-2 text-left transition-[width,background-color,color,transform] duration-150 active:scale-[0.98] ${
                    active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
                  }`}
                >
                  <span className="sidebar-chat-initials size-6 shrink-0 items-center justify-center rounded-[6px] bg-field text-[10px] font-semibold text-ink-2">
                    {recentInitials(item.label)}
                  </span>
                  <span className={`sidebar-copy min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
                    {item.label}
                  </span>
                  {item.waiting && (
                    // A sidebar-copy, so the collapsed rail (no room) hides it with the labels.
                    <span role="img" aria-label="Waiting for your approval" title="Waiting for your approval" data-slot="waiting-mark" className="sidebar-copy ml-2 size-2 shrink-0 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
            {query && visibleRecents.length === 0 && (
              <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">No chats found</div>
            )}
          </GlideGroup>
        </div>

        <div className={`mt-3 flex border-t border-line py-1.5 ${collapsed ? "mx-auto w-8 flex-col-reverse items-center gap-1" : "mx-2 w-[calc(100%-16px)] items-center justify-between"}`}>
          <Tooltip label="Add project" shortcut="⌘O">
            <button type="button" aria-label="Add project" onClick={onOpenProject} className={`${BOTTOM_BAR_BUTTON} ${collapsed ? "size-8" : "size-9"}`}>
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
