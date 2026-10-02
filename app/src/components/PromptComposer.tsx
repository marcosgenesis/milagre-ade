import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrowserIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  AtIcon,
  Cancel01Icon,
  CommandIcon,
  File02Icon,
  Link01Icon,
  Mic01Icon,
  SecurityCheckIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { EffortLevel, ModelCapability, ModelOption, ModelProvider, PermissionMode } from "../model";
import { effortCopy, MODEL_CATALOG, PERMISSION_MODES } from "../model";
import type { ImageDraft } from "./usePastedImages";
import { PickerPanel, PickerRow } from "./primitives/Picker";
import { ProviderLogo } from "./ProviderLogo";
import { useSkills } from "./useSkills";

type SpeechRecognitionResultLike = { [index: number]: { transcript: string } };
type SpeechRecognitionEventLike = Event & { results: { [index: number]: SpeechRecognitionResultLike } };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 15 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

type MenuRow = { key: string; name: string; desc: string; group?: string; source?: string; path?: string };

type Source = { key: string; name: string; desc: string; icon: IconData };

const SOURCES: Source[] = [
  { key: "attach", name: "Add files", desc: "Upload from your computer", icon: Attachment01Icon },
  { key: "context", name: "Project context", desc: "Files, decisions, and shared records", icon: File02Icon },
  { key: "worktrees", name: "Worktrees", desc: "Coordinate connected worktrees", icon: Link01Icon },
  { key: "web", name: "Web search", desc: "Search current information", icon: AiBrowserIcon },
];

const COMMANDS = [
  { key: "summarize", name: "/summarize", desc: "Digest the thread so far" },
  { key: "blockers", name: "/blockers", desc: "Find blockers across worktrees" },
  { key: "plan", name: "/plan", desc: "Draft the next steps" },
  { key: "review", name: "/review", desc: "Review the current agent output" },
];

const FILES = ["project-context.md", "worktree-diff.patch", "agent-output.txt"];

function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w.:-]*)$/.exec(draft);
  if (!match) return null;
  return { kind: match[2] === "@" ? "at" : "slash", query: match[3].toLowerCase(), start: match.index + match[1].length };
}

interface PromptComposerProps {
  imageDraft: ImageDraft;
  projectPath: string;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  sendBlocked: boolean;
  /** A turn is running in this chat; a message sent now steers it. */
  running?: boolean;
  lockedProvider?: ModelProvider;
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
  capability: ModelCapability;
  effort?: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
  ultracode: boolean;
  onUltracodeChange: (on: boolean) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  /** Keep the tall layout (input above the controls) even while the draft is empty. */
  alwaysExpanded?: boolean;
}

const POPOVER_GAP = 12;
// Popovers stay clear of the window-drag strip across the top of the window.
const POPOVER_TOP_INSET = 48;
const POPOVER_BOTTOM_INSET = 16;
// Smallest room below a tall composer that still fits a usable list.
const POPOVER_MIN_BELOW = 220;

/** Rising bars, one per level the model offers; the filled ones show how hard the agent will think. */
function EffortMeter({ level, total }: { level: number; total: number }) {
  return (
    <span aria-hidden className="flex h-3 items-end gap-[2px]">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className="w-[2.5px] rounded-full transition-[background-color,height] duration-200 ease-out motion-reduce:transition-none"
          style={{ height: `${4 + (index * 8) / Math.max(1, total - 1)}px`, background: index <= level ? "currentColor" : "var(--line-strong)" }}
        />
      ))}
    </span>
  );
}

export function PromptComposer({ imageDraft, projectPath, draft, onDraftChange, onSend, sendBlocked, running = false, lockedProvider, selectedModel, onModelChange, capability, effort, onEffortChange, ultracode, onUltracodeChange, permissionMode, onPermissionModeChange, alwaysExpanded = false }: PromptComposerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const effortLevels = capability.efforts;
  const effortIndex = Math.max(0, effortLevels.indexOf(effort ?? ""));
  const effortName = effort ? effortCopy(effort).name : "";
  // Ultracode (Claude) and Codex's ultra level both hand work to parallel agents: they share the accent.
  const orchestrating = ultracode || effort === "ultra";
  const effortLabel = ultracode ? "Ultracode" : effortName;
  const [provider, setProvider] = useState<ModelProvider>(lockedProvider ?? selectedModel.provider);
  // The provider tab follows the open chat, and a locked chat always opens on its own provider.
  useEffect(() => { setProvider(lockedProvider ?? selectedModel.provider); }, [lockedProvider, selectedModel.provider]);
  useEffect(() => { if (modelOpen) setProvider(lockedProvider ?? selectedModel.provider); }, [modelOpen]);
  const [query, setQuery] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const popoverRootRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; maxHeight: number; below: boolean; alignRight: boolean }>({ left: 0, maxHeight: 480, below: false, alignRight: true });
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);

  const token = dismissed ? null : parseToken(draft);
  const menu: "at" | "slash" | null = plusOpen ? "at" : token?.kind ?? null;
  const tokenQuery = plusOpen ? "" : token?.query ?? "";
  const { skills, warnings: skillWarnings, loading: skillsLoading } = useSkills(projectPath, menu === "slash");
  const skillRows = ["workspace", "user"].flatMap((scope) => skills.filter((skill) => skill.scope === scope).map((skill) => ({
    key: `skill:${skill.name}`, name: `/${skill.name}`, desc: skill.description,
    group: scope === "workspace" ? "Workspace skills" : "User skills", source: skill.provider, path: skill.path,
  })));
  const commands: MenuRow[] = [
    ...COMMANDS.filter((command) => !skills.some((skill) => skill.name.toLowerCase() === command.key)).map((command) => ({ ...command, group: "Milagre skills" })),
    ...skillRows,
  ];
  const rows: MenuRow[] = menu === "at"
    ? SOURCES.filter((source) => source.name.toLowerCase().includes(tokenQuery))
    : menu === "slash"
      ? commands.filter((command) => `${command.name.slice(1)} ${command.desc}`.toLowerCase().includes(tokenQuery))
      : [];
  const modelRows = MODEL_CATALOG.filter((model) => model.provider === provider && `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()));
  const canSend = draft.trim().length > 0 || imageDraft.images.length > 0;

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, tokenQuery, projectPath, skills]);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target && engaged) target.scrollIntoView({ block: "nearest" });
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [active, engaged, menu, tokenQuery, rows.length]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    const modelButton = modelRef.current;
    if (!input || !controls || !measure || !modelButton) return;
    const fixedControlsWidth = 28 * 3 + modelButton.offsetWidth;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - 16;
    const needsFullWidth = alwaysExpanded || draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) setExpanded(needsFullWidth);
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 28), 100)}px`;
    input.style.overflowY = contentHeight > 100 ? "auto" : "hidden";
  }, [draft, expanded, selectedModel.name, effortLabel, alwaysExpanded]);

  useEffect(() => {
    if (!modelOpen && !plusOpen && !permissionOpen && !effortOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setModelOpen(false);
        setPlusOpen(false);
        setPermissionOpen(false);
        setEffortOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelOpen, plusOpen, permissionOpen, effortOpen]);

  // Right-align the popover with its trigger, or left-align when that would leave the composer.
  // A tall composer has its controls at the bottom, so its popovers open below when there is room.
  function anchorTo(trigger: HTMLElement, width: number) {
    const root = popoverRootRef.current?.getBoundingClientRect();
    if (!root) return;
    const button = trigger.getBoundingClientRect();
    const alignRight = button.right - width >= root.left;
    const left = Math.max(0, Math.min((alignRight ? button.right - width : button.left) - root.left, root.width - width));
    const roomBelow = window.innerHeight - root.bottom - POPOVER_GAP - POPOVER_BOTTOM_INSET;
    const below = expanded && roomBelow >= POPOVER_MIN_BELOW;
    setAnchor({ left, alignRight, below, maxHeight: below ? roomBelow : root.top - POPOVER_GAP - POPOVER_TOP_INSET });
  }

  const anchorClass = anchor.below ? "top-[calc(100%+0.75rem)]" : "bottom-[calc(100%+0.75rem)]";
  const anchorStyle = {
    left: anchor.left,
    maxHeight: anchor.maxHeight,
    transformOrigin: `${anchor.below ? "top" : "bottom"} ${anchor.alignRight ? "right" : "left"}`,
  };

  function chooseModel(model: ModelOption) {
    onModelChange(model);
    setProvider(model.provider);
    setModelOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) onDraftChange(draft ? `${draft.trimEnd()} ${transcript}` : transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function pick(row: { key: string; name: string }) {
    const source = SOURCES.find((item) => item.key === row.key);
    if (source?.key === "attach") {
      setAttachments((current) => [...current, FILES[current.length % FILES.length]]);
      if (token) onDraftChange(draft.slice(0, token.start));
    } else if (menu === "at") {
      onDraftChange(`${token ? draft.slice(0, token.start) : draft}@${row.name} `);
    } else {
      onDraftChange(`${token ? draft.slice(0, token.start) : draft}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  }

  // Escape closes the slash/@ menu or an open picker, from the prompt or a picker's search field.
  // Only then is it consumed: with nothing open it reaches the window and stops the running turn.
  function handleEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !(menu || modelOpen || permissionOpen || effortOpen)) return;
    event.preventDefault();
    setDismissed(true);
    setPlusOpen(false);
    setModelOpen(false);
    setPermissionOpen(false);
    setEffortOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && rows.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setEngaged(true);
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(rows[active] ?? rows[0]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div data-promptbar className="w-full" onKeyDown={handleEscape}>
      <div ref={popoverRootRef} className="relative">
        {menu && (
          <div onMouseLeave={() => setEngaged(false)} className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-[10px] border border-line bg-surface p-1 shadow-raised" style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}>
            <div className="relative max-h-64 overflow-y-auto" aria-label={menu === "slash" ? "Commands and skills" : "Sources"}>
            <span aria-hidden className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover" style={{ top: rowBox?.top ?? 0, height: rowBox?.height ?? 0, opacity: rowBox && engaged ? 1 : 0, transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease" }} />
            {rows.map((row, index) => {
              const source = menu === "at" ? SOURCES.find((item) => item.key === row.key) : undefined;
              const showGroup = row.group && row.group !== rows[index - 1]?.group;
              return <Fragment key={row.key}>
                {showGroup && <div data-skill-group={row.group} className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{row.group}</div>}
                <button type="button" ref={(element) => { rowRefs.current[index] = element; }} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => { setActive(index); setEngaged(true); }} onClick={() => pick(row)} title={row.path ?? row.desc} className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left">
                {source && <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2"><Icon icon={source.icon} size={15} /></span>}
                <span className="max-w-[45%] shrink-0 truncate text-[12.5px] font-medium text-ink">{row.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                {row.source && <span className="shrink-0 text-[10px] text-ink-3">{row.source}</span>}
              </button>
              </Fragment>;
            })}
            {rows.length === 0 && <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">No matches for “{tokenQuery}”</div>}
            </div>
            {menu === "slash" && skillWarnings.length > 0 && <div role="status" title={skillWarnings.join("\n")} className="px-2 py-1 text-[11px] text-ink-3">{skillWarnings.length === 1 ? skillWarnings[0] : `${skillWarnings.length} skills could not be loaded. Hover for details.`}</div>}
            <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">{menu === "at" ? "Type to search sources & files" : skillsLoading ? "Loading skills…" : "Type to search commands & skills"}</div>
          </div>
        )}

        {modelOpen && (
          <PickerPanel
            title="Choose a model"
            query={query}
            onQueryChange={setQuery}
            placeholder="Search models…"
            emptyLabel="No models found."
            isEmpty={modelRows.length === 0}
            className={`absolute w-[360px] ${anchorClass}`}
            style={anchorStyle}
            header={
              <div className="grid grid-cols-2 gap-1 rounded-control bg-inset p-1">
                {(["codex", "claude"] as ModelProvider[]).map((item) => <button key={item} type="button" disabled={lockedProvider !== undefined && item !== lockedProvider} title={lockedProvider !== undefined && item !== lockedProvider ? `This chat runs on ${lockedProvider === "codex" ? "Codex" : "Claude"}. Start a new chat to use ${item === "codex" ? "Codex" : "Claude"}.` : undefined} className={`flex items-center justify-center gap-1.5 rounded-chip px-2 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${provider === item ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"}`} onClick={() => setProvider(item)}><ProviderLogo provider={item} size={14} />{item === "codex" ? "Codex" : "Claude"}<span className="text-[10px] text-ink-3">{MODEL_CATALOG.filter((model) => model.provider === item).length}</span></button>)}
              </div>
            }
          >
            {modelRows.map((model) => <PickerRow key={model.id} icon={<ProviderLogo provider={model.provider} size={14} />} label={model.name} description={model.description} selected={model.id === selectedModel.id} onClick={() => chooseModel(model)} />)}
          </PickerPanel>
        )}

        {effortOpen && (
          <PickerPanel title="Thinking effort" className={`absolute w-[320px] ${anchorClass}`} style={anchorStyle}>
            {effortLevels.map((level, index) => (
              <PickerRow
                key={level}
                icon={<span className={`flex w-[22px] shrink-0 justify-center ${level === "ultra" ? "text-accent-ink" : "text-ink-2"}`}><EffortMeter level={index} total={effortLevels.length} /></span>}
                label={effortCopy(level).name}
                description={effortCopy(level).description}
                selected={effort === level}
                onClick={() => {
                  onEffortChange(level);
                  setEffortOpen(false);
                  inputRef.current?.focus();
                }}
              />
            ))}
            {capability.ultracode && (
              <button type="button" role="switch" aria-checked={ultracode} onClick={() => onUltracodeChange(!ultracode)} className="mt-1 flex w-full items-center gap-2 rounded-control border border-transparent border-t-line px-2 pt-2.5 pb-1.5 text-left transition-colors hover:bg-inset">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className={`text-xs font-medium ${ultracode ? "text-accent-ink" : "text-ink"}`}>Ultracode</strong>
                  <span className="text-[10px] text-ink-3">Splits big work across parallel agents, at this effort</span>
                </span>
                <span aria-hidden className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors duration-200 ${ultracode ? "bg-accent-ink" : "bg-line-strong"}`}>
                  <span className={`absolute top-[2px] left-[2px] size-[11px] rounded-full bg-surface shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none ${ultracode ? "translate-x-[11px]" : ""}`} />
                </span>
              </button>
            )}
          </PickerPanel>
        )}

        {permissionOpen && (
          <PickerPanel title="Agent permissions" className={`absolute w-[340px] ${anchorClass}`} style={anchorStyle}>
            {PERMISSION_MODES.map((mode) => (
              <PickerRow
                key={mode.id}
                icon={<span className={`flex shrink-0 ${mode.id === "full" ? "text-ink" : mode.id === "auto" ? "text-green" : "text-accent-ink"}`}><Icon icon={SecurityCheckIcon} size={14} /></span>}
                label={mode.name}
                description={mode.description}
                selected={permissionMode === mode.id}
                onClick={() => {
                  onPermissionModeChange(mode.id);
                  setPermissionOpen(false);
                  inputRef.current?.focus();
                }}
              />
            ))}
          </PickerPanel>
        )}

        <div className={`promptbar-surface relative isolate flex flex-col overflow-visible border border-line bg-surface transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${expanded ? "gap-2.5 rounded-[22px] p-3.5" : "gap-1.5 rounded-[14px] p-1.5"}`}>
          {imageDraft.images.length > 0 && <div className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached images">{imageDraft.images.map((image) => <div key={image.id} className="relative rounded-lg border border-line bg-inset p-1"><img src={image.dataUrl} alt={image.name} className="h-20 w-24 rounded object-contain" /><button type="button" aria-label={`Remove image ${image.name}`} onClick={() => imageDraft.remove(image.id)} className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-xs"><Icon icon={Cancel01Icon} size={12} /></button></div>)}</div>}
          {imageDraft.loading && <div role="status" className="px-2 text-xs text-ink-3">Loading images…</div>}
          {imageDraft.error && <div role="alert" className="px-2 text-xs text-red">{imageDraft.error}</div>}
          {attachments.length > 0 && <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">{attachments.map((file, index) => <span key={`${file}-${index}`} className="flex h-6.5 items-center gap-1.5 rounded-chip bg-field py-1 pr-1 pl-1.5 text-[11.5px] text-ink-2 shadow-hairline"><Icon icon={File02Icon} size={12} /><span className="max-w-36 truncate">{file}</span><button type="button" aria-label={`Remove ${file}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="flex size-5 items-center justify-center rounded-[5px] text-ink-3 hover:bg-line hover:text-ink"><Icon icon={Cancel01Icon} size={10} /></button></span>)}</div>}
          <span ref={measureRef} aria-hidden="true" className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]">{draft}</span>
          <div ref={controlsRef} className={`grid items-end gap-x-1 gap-y-1.5 ${expanded ? "grid-cols-[28px_auto_minmax(0,1fr)_auto_28px_28px]" : "grid-cols-[28px_minmax(0,1fr)_auto_auto_28px_28px]"}`}>
            <button type="button" aria-label="Add attachments and sources" aria-expanded={plusOpen} onClick={() => { setModelOpen(false); setPlusOpen((current) => !current); inputRef.current?.focus(); }} className={`flex size-7 shrink-0 items-center justify-center text-ink-3 transition-colors hover:bg-hover hover:text-ink ${plusOpen ? "bg-hover" : ""}`}><Icon icon={Add01Icon} size={16} /></button>
            <textarea onPaste={(event) => void imageDraft.onPaste(event)} ref={inputRef} rows={1} value={draft} onChange={(event) => { onDraftChange(event.target.value); setDismissed(false); setPlusOpen(false); }} onKeyDown={handleKeyDown} placeholder={listening ? "Listening…" : running ? "Steer the agent…" : "Prompt or tag a worktree with @"} aria-label="Prompt" className={`${expanded ? "col-span-full col-start-1 row-start-1 min-h-[68px] px-2 py-2 text-[14px] leading-5" : "col-start-2 row-start-1 min-h-7 px-1 py-[5px] text-[13px] leading-[18px]"} min-w-0 w-full resize-none overflow-hidden bg-transparent text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3`} />
            <div ref={modelRef} className={`flex shrink-0 items-center gap-0.5 ${expanded ? "col-start-2 row-start-2 justify-self-start" : "col-start-3 row-start-1"}`}>
            <button type="button" aria-expanded={modelOpen} onClick={(event) => { anchorTo(event.currentTarget, 360); setPlusOpen(false); setPermissionOpen(false); setEffortOpen(false); setModelOpen((current) => !current); }} className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"><ProviderLogo provider={selectedModel.provider} size={13} /><span className="max-w-28 truncate">{selectedModel.name}</span><Icon icon={ArrowDown01Icon} size={12} /></button>
            {effortLevels.length > 0 && <button type="button" aria-label={`Thinking effort: ${effortName}${ultracode ? ", ultracode on" : ""}`} title={`Thinking effort: ${effortName}${ultracode ? ", ultracode on" : ""}`} aria-expanded={effortOpen} onClick={(event) => { anchorTo(event.currentTarget, 320); setPlusOpen(false); setModelOpen(false); setPermissionOpen(false); setEffortOpen((current) => !current); }} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-1.5 text-[12px] font-medium transition-colors hover:bg-hover ${effortOpen ? "bg-hover" : ""} ${orchestrating ? "text-accent-ink" : effortOpen ? "text-ink" : "text-ink-2 hover:text-ink"}`}><EffortMeter level={effortIndex} total={effortLevels.length} /><span className="hidden min-[900px]:inline">{effortLabel}</span></button>}
            </div>
            <button type="button" aria-label="Agent permissions" aria-expanded={permissionOpen} onClick={(event) => { anchorTo(event.currentTarget, 340); setPlusOpen(false); setModelOpen(false); setEffortOpen(false); setPermissionOpen((current) => !current); }} className={`flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium transition-colors hover:bg-hover ${permissionMode === "full" ? "text-ink" : permissionMode === "auto" ? "text-green" : "text-ink-2"} ${expanded ? "col-start-3 row-start-2 justify-self-start" : "col-start-4 row-start-1"}`}><Icon icon={SecurityCheckIcon} size={14} /><span className="hidden min-[900px]:inline">{permissionMode === "ask" ? "Ask" : permissionMode === "auto" ? "Auto" : "Full"}</span></button>
            <button type="button" aria-label={listening ? "Stop voice input" : "Start voice input"} aria-pressed={listening} onClick={toggleListening} className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors ${expanded ? "col-start-5 row-start-2" : "col-start-5 row-start-1"} ${listening ? "bg-accent-tint text-accent-ink" : "text-ink-3 hover:bg-hover hover:text-ink"}`}><Icon icon={Mic01Icon} size={15} /></button>
            <button type="button" aria-label="Send" disabled={!canSend || sendBlocked || imageDraft.loading} onClick={onSend} className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] text-surface transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-2 ${expanded ? "col-start-6 row-start-2" : "col-start-6 row-start-1"}`} style={{ background: canSend && !sendBlocked ? "var(--ink)" : "var(--line-strong)" }}><Icon icon={ArrowUp01Icon} size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
