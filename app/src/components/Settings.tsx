import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, GitBranchIcon, InformationCircleIcon, PaintBoardIcon, SecurityCheckIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import type { FilesToCopy as FilesToCopyResult, WorktreeSetupSettings } from "../electron";
import { DEFAULT_FILES_TO_COPY, parsePatterns, previewSentence } from "../lib/files-to-copy";
import { PERMISSION_MODES } from "../model";
import type { ModelOption, PermissionMode } from "../model";
import { providerForId, resolveModel } from "../lib/models";
import { updateSettings, useSettings } from "../lib/settings";
import type { ClaudeReplies, ThemePreference, UsageDisplay } from "../lib/settings";
import type { ChatOrder } from "../lib/chat-list";
import { useEditors } from "../lib/editors";
import { GlideGroup, RailButton } from "./SidebarNav";
import { Select } from "./primitives/Select";
import { ProviderLogo } from "./ProviderLogo";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function Icon({ icon, size = 18 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

export type SettingsSection = "general" | "appearance" | "about" | "project";

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: IconData }> = [
  { key: "general", label: "General", icon: Settings01Icon },
  { key: "appearance", label: "Appearance", icon: PaintBoardIcon },
  { key: "about", label: "About", icon: InformationCircleIcon },
];

const PROJECT_SECTION = { key: "project" as const, label: "Worktrees", icon: GitBranchIcon };

export function SettingsNav({ section, projectName, onSelect, onBack }: { section: SettingsSection; projectName?: string; onSelect: (section: SettingsSection) => void; onBack: () => void }) {
  return (
    <aside aria-label="Settings navigation" className="flex h-full w-[224px] shrink-0 flex-col overflow-hidden rounded-window bg-surface shadow-card">
      <div aria-hidden className="h-8 shrink-0" />
      <GlideGroup>
        <RailButton icon={<Icon icon={ArrowLeft02Icon} />} label="Back" onClick={onBack} />
      </GlideGroup>
      <div className="mx-4 my-2 h-px bg-line" />
      <div className="mx-2 flex h-8 items-center px-2 text-[12.5px] font-medium text-ink-3">App</div>
      <GlideGroup>
        {SECTIONS.map((item) => (
          <RailButton key={item.key} icon={<Icon icon={item.icon} />} label={item.label} active={section === item.key} onClick={() => onSelect(item.key)} />
        ))}
      </GlideGroup>
      <div className="mx-2 mt-2 flex h-8 items-center px-2 text-[12.5px] font-medium text-ink-3"><span className="truncate">{projectName ? `Project · ${projectName}` : "Project"}</span></div>
      <GlideGroup>
        <RailButton icon={<Icon icon={PROJECT_SECTION.icon} />} label={PROJECT_SECTION.label} active={section === PROJECT_SECTION.key} onClick={() => onSelect(PROJECT_SECTION.key)} />
      </GlideGroup>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-[12px] font-medium text-ink-3">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[12px] bg-surface shadow-card">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">{label}</span>
        {description && <span className="text-[12px] text-ink-3">{description}</span>}
      </div>
      <div className="shrink-0 text-[13px] text-ink-2">{children}</div>
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative flex h-5 w-8 items-center rounded-full transition-colors duration-150 ${checked ? "bg-ink" : "bg-line-strong"}`}
    >
      <span className={`absolute left-0.5 size-4 rounded-full bg-surface shadow-card transition-transform duration-150 ${checked ? "translate-x-3" : "translate-x-0"}`} />
    </button>
  );
}

function GeneralSettings({ models }: { models: ModelOption[] }) {
  const settings = useSettings();
  const { editors, editor } = useEditors();
  return (
    <>
    <Group title="Agents">
      <Row label="Default model" description="Used for new chats; remembers your last selection">
        <Select
          label="Default model"
          title="Choose a model"
          width={280}
          value={resolveModel(models, settings.defaultModelId, providerForId(settings.defaultModelId)).id}
          onChange={(defaultModelId) => updateSettings({ defaultModelId })}
          options={(["codex", "claude"] as const).flatMap((provider) => models.filter((model) => model.provider === provider).map((model) => ({
            value: model.id,
            label: model.name,
            icon: <ProviderLogo provider={provider} size={14} />,
            group: provider === "codex" ? "Codex" : "Claude",
          })))}
        />
      </Row>
      <Row label="Default permission" description="Used for new chats; remembers your last selection">
        <Select<PermissionMode>
          label="Default permission"
          title="Agent permissions"
          width={340}
          value={settings.defaultPermissionMode}
          onChange={(defaultPermissionMode) => updateSettings({ defaultPermissionMode })}
          options={PERMISSION_MODES.map((mode) => ({
            value: mode.id,
            label: mode.name,
            description: mode.description,
            icon: <span className={`flex shrink-0 ${mode.id === "full" ? "text-ink" : mode.id === "auto" ? "text-green" : "text-accent-ink"}`}><Icon icon={SecurityCheckIcon} size={14} /></span>,
          }))}
        />
      </Row>
      <Row label="TLDR writing" description="Shape Claude and Codex updates and replies with /tldr. Applies on the next turn after the current reply finishes.">
        <Switch label="TLDR writing" checked={settings.tldrEnabled} onChange={(tldrEnabled) => updateSettings({ tldrEnabled })} />
      </Row>
      <Row label="Claude replies">
        <Select<ClaudeReplies>
          label="Claude replies"
          value={settings.claudeReplies}
          onChange={(claudeReplies) => updateSettings({ claudeReplies })}
          options={[{ value: "concise", label: "Concise" }, { value: "normal", label: "Normal" }]}
        />
      </Row>
      <Row label="Notify when finished" description="When a turn finishes or fails while you are outside the chat">
        <Switch label="Notify when finished" checked={settings.notifyOnCompletion} onChange={(notifyOnCompletion) => updateSettings({ notifyOnCompletion })} />
      </Row>
      <Row label="Dock badge" description="Count chats with unread replies or waiting for your input">
        <Switch label="Dock badge" checked={settings.showDockBadge} onChange={(showDockBadge) => updateSettings({ showDockBadge })} />
      </Row>
      <Row label="Notify when waiting" description="When a chat needs an approval or an answer and Milagre is in the background">
        <Switch label="Notify when waiting" checked={settings.notifyWhenWaiting} onChange={(notifyWhenWaiting) => updateSettings({ notifyWhenWaiting })} />
      </Row>
    </Group>
    <Group title="Sidebar">
      <Row label="Chat order" description="Newest chat first keeps chats in place as replies arrive">
        <Select<ChatOrder>
          label="Chat order"
          value={settings.chatOrder}
          onChange={(chatOrder) => updateSettings({ chatOrder })}
          options={[{ value: "created", label: "Newest chat first" }, { value: "recent", label: "Latest message first" }]}
        />
      </Row>
    </Group>
    <Group title="Editor">
      <Row label="Open files in" description={editors && editors.length === 0 ? "Install Cursor, VS Code, Zed or another editor to open files and folders" : "Used by file links in replies and tool rows, and by Open in <editor> in the chat menu"}>
        {editors && editors.length === 0 ? (
          <span className="text-ink-3">No editor found</span>
        ) : (
          <Select
            label="Open files in"
            value={editor?.id ?? ""}
            onChange={(editorId) => updateSettings({ editorId })}
            options={(editors ?? []).map((item) => ({ value: item.id, label: item.name }))}
          />
        )}
      </Row>
    </Group>
    <Group title="System">
      <Row label="Keep the Mac awake while agents work" description="The screen can still turn off.">
        <Switch label="Keep the Mac awake while agents work" checked={settings.keepAwake} onChange={(keepAwake) => updateSettings({ keepAwake })} />
      </Row>
    </Group>
    <Group title="Plan usage">
      <Row label="Show" description="Claude and Codex plan limits">
        <Select<UsageDisplay>
          label="Show usage as"
          value={settings.usageDisplay}
          onChange={(usageDisplay) => updateSettings({ usageDisplay })}
          options={[{ value: "used", label: "Used" }, { value: "remaining", label: "Remaining" }]}
        />
      </Row>
      <Row label="Show in sidebar" description="Hover a provider for its limits and reset times">
        <Switch label="Show usage in sidebar" checked={settings.showUsageInSidebar} onChange={(showUsageInSidebar) => updateSettings({ showUsageInSidebar })} />
      </Row>
    </Group>
    </>
  );
}

function AppearanceSettings() {
  const settings = useSettings();
  return (
    <Group title="Theme">
      <Row label="Theme" description="System follows your macOS appearance. Press ⌘⇧T to switch between light and dark.">
        <Select<ThemePreference>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
        />
      </Row>
    </Group>
  );
}

function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void window.milagre.getAppVersion().then(setVersion);
  }, []);
  const electron = navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1];
  const chrome = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1];
  return (
    <Group title="Milagre">
      <Row label="Version"><span className="tabular-nums">{version ?? "…"}</span></Row>
      {electron && <Row label="Runtime"><span className="tabular-nums">Electron {electron} · Chromium {chrome}</span></Row>}
      <Row label="License">MIT</Row>
    </Group>
  );
}

/* ─────────────────────────────────────────────────────────
 * FILES TO COPY
 * Ignored files (env files, local secrets) a new worktree gets from
 * the project's main checkout. .gitignore syntax; .worktreeinclude
 * at the repo root wins. The preview runs the same matching.
 * ───────────────────────────────────────────────────────── */
function FilesToCopy({ projectPath }: { projectPath: string }) {
  const [text, setText] = useState<string | null>(null);
  const [found, setFound] = useState<FilesToCopyResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const current = useRef("");
  const saveTimer = useRef<number | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewSeq = useRef(0);

  const flush = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    window.milagre.saveFilesToCopy(projectPath, parsePatterns(next)).then(
      () => setSaveError(null),
      (error) => setSaveError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error)),
    );
  };

  // The preview runs shortly after typing stops; only the latest answer is shown.
  const refreshPreview = () => {
    const seq = ++previewSeq.current;
    void window.milagre.previewFilesToCopy(projectPath, parsePatterns(current.current)).then((next) => {
      if (seq === previewSeq.current) setFound(next);
    }, () => {});
  };

  // .worktreeinclude can change in an editor while Settings is open.
  useEffect(() => {
    const onFocus = () => refreshPreview();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setFound(null);
    setLoadError(null);
    window.milagre.readFilesToCopy(projectPath).then((saved) => {
      if (cancelled) return;
      current.current = saved.filesToCopy.join("\n");
      setText(current.current);
      setFound(saved);
    }, (error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    // Leaving Settings saves what was typed last.
    return () => {
      cancelled = true;
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      flush();
    };
  }, [projectPath]);

  const edit = (value: string) => {
    setText(value);
    current.current = value;
    pending.current = value;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(refreshPreview, 300);
  };

  const locked = found?.source === "worktreeinclude";
  return (
    <div className="grid gap-2 px-4 py-3">
      <label htmlFor="files-to-copy" className="grid gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">Files to copy</span>
        <span className="text-[12px] text-ink-3">
          Git-ignored files copied from the main checkout into each new worktree, such as env files. One pattern per line, .gitignore syntax. Leave empty for {DEFAULT_FILES_TO_COPY}.
        </span>
      </label>
      <textarea
        id="files-to-copy"
        rows={5}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        readOnly={locked}
        disabled={text === null && !loadError}
        value={locked ? found.worktreeInclude ?? "" : text ?? ""}
        placeholder={DEFAULT_FILES_TO_COPY}
        onChange={(event) => edit(event.target.value)}
        className={`w-full resize-y rounded-control border border-line px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-ink-3 ${locked ? "bg-field text-ink-2" : "bg-surface"}`}
      />
      {locked && <p data-files-to-copy-locked className="text-[12px] text-ink-2">.worktreeinclude in the repo wins. Edit that file to change what is copied.</p>}
      {loadError ? (
        <p className="text-[12px] text-red">Couldn't read this project's files: {loadError}</p>
      ) : (
        <p data-files-to-copy-preview className="break-words text-[12px] text-ink-3">{found ? previewSentence(found.matches) : "Checking…"}</p>
      )}
      {saveError && <p data-files-to-copy-error className="break-words text-[12px] text-red">Couldn't save: {saveError}</p>}
    </div>
  );
}

const ipcMessage = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));

/* ─────────────────────────────────────────────────────────
 * SETUP COMMAND
 * Runs once in each new worktree, before the chat's first turn
 * (npm ci, uv sync). "setup" in .milagre/worktree.json at the
 * repo root wins, like .worktreeinclude does for the files.
 * ───────────────────────────────────────────────────────── */
function SetupCommand({ projectPath }: { projectPath: string }) {
  const [text, setText] = useState<string | null>(null);
  const [resolved, setResolved] = useState<WorktreeSetupSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const flush = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    window.milagre.saveWorktreeSetup(projectPath, next).then((saved) => {
      setResolved(saved);
      setError(null);
    }, (failure) => setError(`Couldn't save: ${ipcMessage(failure)}`));
  };

  // .milagre/worktree.json can change in an editor while Settings is open.
  useEffect(() => {
    const onFocus = () => void window.milagre.readWorktreeSetup(projectPath).then(setResolved, () => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setResolved(null);
    setError(null);
    window.milagre.readWorktreeSetup(projectPath).then((saved) => {
      if (cancelled) return;
      setText(saved.setupCommand);
      setResolved(saved);
    }, (failure) => {
      if (!cancelled) setError(`Couldn't read the setup command: ${ipcMessage(failure)}`);
    });
    // Leaving Settings saves what was typed last.
    return () => {
      cancelled = true;
      flush();
    };
  }, [projectPath]);

  const edit = (value: string) => {
    setText(value);
    pending.current = value;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
  };

  const locked = resolved?.source === "repo";
  return (
    <div className="grid gap-2 px-4 py-3">
      <label htmlFor="setup-command" className="grid gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">Setup command</span>
        <span className="text-[12px] text-ink-3">Runs once in each new worktree before the agent starts, e.g. npm ci.</span>
      </label>
      <input
        id="setup-command"
        type="text"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        readOnly={locked}
        disabled={text === null && !error}
        value={locked ? resolved.command ?? "" : text ?? ""}
        placeholder={locked ? "Nothing runs" : "npm ci"}
        onChange={(event) => edit(event.target.value)}
        className={`h-9 w-full rounded-control border border-line px-3 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-ink-3 ${locked ? "bg-field text-ink-2" : "bg-surface"}`}
      />
      {locked && <p data-setup-command-locked className="text-[12px] text-ink-2">.milagre/worktree.json in the repo wins. Edit its "setup" to change the command.</p>}
      {resolved?.note && <p data-setup-command-note className="break-words text-[12px] text-red">{resolved.note}</p>}
      {error && <p data-setup-command-error className="break-words text-[12px] text-red">{error}</p>}
    </div>
  );
}

function ProjectSettings({ projectPath }: { projectPath?: string }) {
  if (!projectPath) return <p className="mt-6 text-[13px] text-ink-3">Open a project to change its settings.</p>;
  return (
    <Group title="New worktrees">
      <FilesToCopy projectPath={projectPath} />
      <SetupCommand projectPath={projectPath} />
    </Group>
  );
}

export function SettingsPanel({ section, projectPath, models }: { section: SettingsSection; projectPath?: string; models: ModelOption[] }) {
  const title = section === "project" ? PROJECT_SECTION.label : SECTIONS.find((item) => item.key === section)?.label;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 pt-14 pb-10">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {section === "general" && <GeneralSettings models={models} />}
        {section === "appearance" && <AppearanceSettings />}
        {section === "about" && <AboutSettings />}
        {section === "project" && <ProjectSettings projectPath={projectPath} />}
      </div>
    </div>
  );
}
