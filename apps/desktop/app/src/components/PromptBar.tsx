import { PROVIDERS, providerName } from "@milagre/shared/providers";
import { useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrowserIcon,
  AiChat01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  AtIcon,
  CommandIcon,
  Search01Icon,
  SlidersHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { ModelOption, ModelProvider } from "../model";
import { MODEL_CATALOG } from "../model";
import { ScrollArea } from "./primitives/ScrollArea";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 16 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

interface PromptBarProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
}

function ProviderIcon({ provider, size = 14 }: { provider: ModelProvider; size?: number }) {
  return <Icon icon={provider === "codex" ? AiChat01Icon : AiBrowserIcon} size={size} />;
}

export function PromptBar({
  draft,
  onDraftChange,
  onSend,
  selectedModel,
  onModelChange,
}: PromptBarProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>(selectedModel.provider);
  const [query, setQuery] = useState("");
  const models = useMemo(
    () => MODEL_CATALOG.filter((model) => model.provider === provider && `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())),
    [provider, query],
  );

  function chooseModel(model: ModelOption) {
    onModelChange(model);
    setProvider(model.provider);
    setModelMenuOpen(false);
    setQuery("");
  }

  return (
    <div className="relative mx-auto w-full max-w-3xl rounded-window border border-line bg-surface p-3 shadow-raised">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button className="flex size-7 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink" aria-label="Attach files"><Icon icon={Add01Icon} size={17} /></button>
          <button className="inline-flex items-center gap-1 rounded-control px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink"><Icon icon={Attachment01Icon} size={14} /> Attach</button>
          <button className="inline-flex items-center gap-1 rounded-control px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink"><Icon icon={AtIcon} size={14} /> Context</button>
          <button className="inline-flex items-center gap-1 rounded-control px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink"><Icon icon={CommandIcon} size={14} /> Commands</button>
        </div>
        <div className="relative">
          <button className="inline-flex items-center gap-1.5 rounded-control bg-inset px-2 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-hover" onClick={() => setModelMenuOpen((open) => !open)}>
            <span className={`flex size-5 items-center justify-center rounded-chip ${selectedModel.provider === "claude" ? "bg-orange-tint text-orange" : "bg-accent-tint text-accent-ink"}`}><ProviderIcon provider={selectedModel.provider} size={14} /></span>
            <span>{selectedModel.name}</span>
            <Icon icon={ArrowDown01Icon} size={14} />
          </button>
          {modelMenuOpen && (
            <div className="absolute bottom-[calc(100%+0.75rem)] right-0 z-10 w-[390px] rounded-window border border-line bg-surface p-3 shadow-overlay">
              <div className="flex items-start justify-between px-1 pb-2 text-ink">
                <div className="grid gap-0.5"><strong className="text-sm">Choose a model</strong><span className="text-xs text-ink-3">All available Codex and Claude models</span></div>
                <Icon icon={SlidersHorizontalIcon} size={16} />
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-control bg-inset p-1">
                {PROVIDERS.map((item) => (
                  <button key={item} className={`flex items-center justify-center gap-1.5 rounded-chip px-2 py-1.5 text-xs font-semibold transition-colors ${provider === item ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"}`} onClick={() => setProvider(item)}>
                    <ProviderIcon provider={item} size={14} /> {providerName(item)}
                    <span className="text-[10px] text-ink-3">{MODEL_CATALOG.filter((model) => model.provider === item).length}</span>
                  </button>
                ))}
              </div>
              <label className="my-2 flex items-center gap-2 rounded-control border border-line px-2.5 py-2 text-ink-3"><Icon icon={Search01Icon} size={15} /><input className="w-full border-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" autoFocus /></label>
              <ScrollArea className="grid max-h-72 gap-0.5">
                {models.map((model) => (
                  <button key={model.id} className={`flex w-full items-center gap-2 rounded-control border px-2 py-2 text-left transition-colors ${model.id === selectedModel.id ? "border-line-strong bg-hover" : "border-transparent hover:border-line hover:bg-inset"}`} onClick={() => chooseModel(model)}>
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-control ${model.provider === "claude" ? "bg-orange-tint text-orange" : "bg-accent-tint text-accent-ink"}`}><ProviderIcon provider={model.provider} size={15} /></span>
                    <span className="grid min-w-0 flex-1 gap-0.5"><strong className="truncate text-xs text-ink">{model.name}</strong><small className="truncate text-[10px] text-ink-3">{model.description}</small><code className="text-[9px] text-ink-3">{model.id}</code></span>
                    {model.recommended && <span className="shrink-0 rounded-chip bg-green-tint px-1.5 py-1 text-[9px] font-semibold text-green">Recommended</span>}
                    {model.id === selectedModel.id && <Icon icon={Tick02Icon} size={16} />}
                  </button>
                ))}
                {models.length === 0 && <div className="px-2 py-5 text-center text-xs text-ink-3">No models found.</div>}
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <textarea
          className="min-h-9 max-h-32 flex-1 resize-none border-0 bg-transparent text-sm leading-6 text-ink outline-none placeholder:text-ink-3"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask about your agents, worktrees, or next steps…"
          rows={1}
        />
        <button className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent text-white transition-transform hover:-translate-y-0.5 hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50" onClick={onSend} aria-label="Send message"><Icon icon={ArrowUp01Icon} size={18} /></button>
      </div>
    </div>
  );
}
