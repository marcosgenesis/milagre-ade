import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowLeft02Icon, GitBranchIcon, InformationCircleIcon, PaintBoardIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import type { FilesToCopy as FilesToCopyResult } from "../electron";
import { DEFAULT_FILES_TO_COPY, parsePatterns, previewSentence } from "../lib/files-to-copy";
import { MODEL_CATALOG, PERMISSION_MODES } from "../model";
import type { PermissionMode } from "../model";
import { updateSettings, useSettings } from "../lib/settings";
import type { ThemePreference, UsageDisplay } from "../lib/settings";
import { GlideGroup, RailButton } from "./SidebarNav";

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

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 appearance-none rounded-control border border-line bg-surface pr-8 pl-3 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-3"><Icon icon={ArrowDown01Icon} size={14} /></span>
    </span>
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

function GeneralSettings() {
  const settings = useSettings();
  return (
    <>
    <Group title="Agents">
      <Row label="Default model" description="Selected when Milagre opens">
        <Select label="Default model" value={settings.defaultModelId} onChange={(defaultModelId) => updateSettings({ defaultModelId })}>
          {(["codex", "claude"] as const).map((provider) => (
            <optgroup key={provider} label={provider === "codex" ? "Codex" : "Claude"}>
              {MODEL_CATALOG.filter((model) => model.provider === provider).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </optgroup>
          ))}
        </Select>
      </Row>
      <Row label="Default permission" description="Applied when Milagre opens">
        <Select label="Default permission" value={settings.defaultPermissionMode} onChange={(mode) => updateSettings({ defaultPermissionMode: mode as PermissionMode })}>
          {PERMISSION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
        </Select>
      </Row>
      <Row label="Notify when waiting" description="When a chat needs an approval or an answer and Milagre is in the background">
        <Switch label="Notify when waiting" checked={settings.notifyWhenWaiting} onChange={(notifyWhenWaiting) => updateSettings({ notifyWhenWaiting })} />
      </Row>
    </Group>
    <Group title="Plan usage">
      <Row label="Show" description="Claude and Codex plan limits">
        <Select label="Show usage as" value={settings.usageDisplay} onChange={(display) => updateSettings({ usageDisplay: display as UsageDisplay })}>
          <option value="used">Used</option>
          <option value="remaining">Remaining</option>
        </Select>
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
      <Row label="Theme" description="System follows your macOS appearance">
        <Select label="Theme" value={settings.theme} onChange={(theme) => updateSettings({ theme: theme as ThemePreference })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
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
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const previewSeq = useRef(0);

  const flush = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) void window.milagre.saveFilesToCopy(projectPath, parsePatterns(next)).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setFound(null);
    setLoadError(null);
    window.milagre.readFilesToCopy(projectPath).then((saved) => {
      if (cancelled) return;
      setText(saved.filesToCopy.join("\n"));
      setFound(saved);
    }, (error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
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
    const seq = ++previewSeq.current;
    void window.milagre.previewFilesToCopy(projectPath, parsePatterns(value)).then((next) => {
      if (seq === previewSeq.current) setFound(next);
    }, () => {});
  };

  const locked = found?.source === "worktreeinclude";
  return (
    <Group title="New worktrees">
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
      </div>
    </Group>
  );
}

function ProjectSettings({ projectPath }: { projectPath?: string }) {
  if (!projectPath) return <p className="mt-6 text-[13px] text-ink-3">Open a project to change its settings.</p>;
  return <FilesToCopy projectPath={projectPath} />;
}

export function SettingsPanel({ section, projectPath }: { section: SettingsSection; projectPath?: string }) {
  const title = section === "project" ? PROJECT_SECTION.label : SECTIONS.find((item) => item.key === section)?.label;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 pt-14 pb-10">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {section === "general" && <GeneralSettings />}
        {section === "appearance" && <AppearanceSettings />}
        {section === "about" && <AboutSettings />}
        {section === "project" && <ProjectSettings projectPath={projectPath} />}
      </div>
    </div>
  );
}
