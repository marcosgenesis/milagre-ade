import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, PaintBoardIcon } from "@hugeicons/core-free-icons";
import { artifactDocument, type Artifact } from "@milagre/shared/artifact";
import type { ArtifactRef, ChatStep } from "../../model";
import Tooltip from "../primitives/Tooltip";

// Docked width plus the 12px gap to the chat. The chat panes reserve it through --artifact-dock.
const DOCK_WIDTH = 560;

type ArtifactsValue = {
  /** The Chat's key, or null where designs can't be read (a new Chat, a shared Link Chat). */
  chatId: string | null;
  /** The newest version of each design the Chat's replies showed, by id. */
  latest: Map<string, ArtifactRef>;
  opened: { id: string; version: number | null } | null;
  open: (ref: ArtifactRef) => void;
};
const Artifacts = createContext<ArtifactsValue>({ chatId: null, latest: new Map(), opened: null, open: () => {} });

/** The newest version of each design among a Chat's steps. */
export function latestArtifacts(steps: ChatStep[]): Map<string, ArtifactRef> {
  const latest = new Map<string, ArtifactRef>();
  for (const step of steps)
    if (step.kind === "artifact" && step.artifact && (latest.get(step.artifact.id)?.version ?? 0) < step.artifact.version)
      latest.set(step.artifact.id, step.artifact);
  return latest;
}

function useArtifact(chatId: string | null, id: string, version: number | null) {
  const [state, setState] = useState<{ artifact: Artifact | null; error: string | null }>({ artifact: null, error: null });
  useEffect(() => {
    if (!chatId) return;
    let live = true;
    window.milagre.artifacts
      .get({ chatId, id, ...(version === null ? {} : { version }) })
      .then((artifact) => live && setState({ artifact, error: null }))
      .catch((error: unknown) => live && setState({ artifact: null, error: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
  }, [chatId, id, version]);
  return state;
}

/**
 * A design runs in a sandbox with no same origin and a policy that blocks its own requests: it can't reach Milagre,
 * the Chat or the network. A preview also takes no input, so the card scrolls with the chat.
 */
function ArtifactFrame({ html, title, preview = false }: { html: string; title: string; preview?: boolean }) {
  const document = useMemo(() => artifactDocument(html), [html]);
  return (
    <iframe
      title={title}
      srcDoc={document}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={preview ? -1 : undefined}
      className={`block size-full border-0 bg-white ${preview ? "pointer-events-none" : ""}`}
    />
  );
}

/** A design the agent showed: its first screen, and a button that opens it beside the chat. */
export const ArtifactCard = memo(function ArtifactCard({ step }: { step: ChatStep & { artifact: ArtifactRef } }) {
  const { chatId, latest, open } = useContext(Artifacts);
  const { id, version, title } = step.artifact;
  const { artifact, error } = useArtifact(chatId, id, version);
  const newest = latest.get(id)?.version ?? version;
  return (
    <div data-slot="artifact-card" data-artifact={id} className="my-2 max-w-xl overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="relative h-56 overflow-hidden border-b border-line bg-white">
        {artifact ? (
          // Laid out at desktop width and scaled down, so the card shows the design as it will open.
          <div className="absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50">
            <ArtifactFrame html={artifact.html} title={`Preview of ${title}`} preview />
          </div>
        ) : (
          <div className="grid size-full place-items-center px-6 text-center text-[12px] text-ink-3">
            {error ?? (chatId ? "Loading design…" : "Open this Chat in its Project to see the design.")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <HugeiconsIcon icon={PaintBoardIcon} size={16} className="shrink-0 text-ink-2" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink">{title}</div>
          <div className="text-[11px] text-ink-3">
            Version {version}
            {newest > version ? ` · version ${newest} is newer` : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={!chatId}
          onClick={() => open(step.artifact)}
          className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-50"
        >
          Open
        </button>
      </div>
    </div>
  );
});

/** The designs of one Chat: cards in its replies and the panel docked beside it. */
export function ArtifactsProvider({ chatId, steps, children }: { chatId: string | null; steps: ChatStep[]; children: React.ReactNode }) {
  const latest = useMemo(() => latestArtifacts(steps), [steps]);
  // What is open belongs to the Chat it opened in: switching Chats closes it.
  const [openedIn, setOpenedIn] = useState<{ chatId: string | null; design: ArtifactsValue["opened"] }>({ chatId, design: null });
  const opened = openedIn.chatId === chatId ? openedIn.design : null;
  const setOpened = useCallback((design: ArtifactsValue["opened"]) => setOpenedIn({ chatId, design }), [chatId]);
  // A card opens the version it shows; when that is the newest, the panel follows the agent's next revisions.
  const value = useMemo<ArtifactsValue>(
    () => ({ chatId, latest, opened, open: (ref) => setOpened({ id: ref.id, version: latest.get(ref.id)?.version === ref.version ? null : ref.version }) }),
    [chatId, latest, opened, setOpened],
  );
  return (
    <Artifacts.Provider value={value}>
      {children}
      {opened && chatId && (
        <ArtifactDock
          key={opened.id}
          chatId={chatId}
          id={opened.id}
          version={opened.version}
          onVersion={(version) => setOpened({ id: opened.id, version })}
          onClose={() => setOpened(null)}
        />
      )}
    </Artifacts.Provider>
  );
}

function ArtifactDock({
  chatId,
  id,
  version,
  onVersion,
  onClose,
}: {
  chatId: string;
  id: string;
  version: number | null;
  onVersion: (version: number | null) => void;
  onClose: () => void;
}) {
  const { latest } = useContext(Artifacts);
  // Following the newest, a revision the agent shows replaces what is open.
  const newest = latest.get(id)?.version;
  const { artifact, error } = useArtifact(chatId, id, version ?? newest ?? null);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--artifact-dock", `${DOCK_WIDTH + 12}px`);
    return () => {
      root.removeProperty("--artifact-dock");
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !event.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = artifact?.version ?? version ?? newest ?? 1;
  const last = Math.max(artifact?.latest ?? 1, newest ?? 1);
  const go = (next: number) => onVersion(next >= last ? null : next);
  return createPortal(
    <div
      role="dialog"
      aria-label={artifact?.title ?? "Design"}
      aria-modal="false"
      data-slot="artifact-dock"
      // Beside a docked simulator, not under it.
      style={{ top: 40, right: "calc(12px + var(--simulator-dock, 0px))", bottom: 12, width: DOCK_WIDTH }}
      className="fixed z-40 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-ink shadow-raised"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <HugeiconsIcon icon={PaintBoardIcon} size={16} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">{artifact?.title ?? "Design"}</div>
          <div className="text-[11px] text-ink-3">
            Version {shown} of {last}
            {version === null ? " · follows the agent's revisions" : ""}
          </div>
        </div>
        <Tooltip label="Previous version">
          <button
            type="button"
            aria-label="Previous version"
            disabled={shown <= 1}
            onClick={() => go(shown - 1)}
            className="rounded p-1 text-ink-2 hover:bg-hover disabled:opacity-40"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Next version">
          <button
            type="button"
            aria-label="Next version"
            disabled={shown >= last}
            onClick={() => go(shown + 1)}
            className="rounded p-1 text-ink-2 hover:bg-hover disabled:opacity-40"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Close design">
          <button type="button" aria-label="Close design" onClick={onClose} className="rounded p-1 text-ink-2 hover:bg-hover">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
          </button>
        </Tooltip>
      </header>
      <div className="min-h-0 flex-1 bg-white">
        {artifact ? (
          <ArtifactFrame key={artifact.version} html={artifact.html} title={artifact.title} />
        ) : (
          <div className="grid size-full place-items-center px-6 text-center text-[12px] text-ink-3">{error ?? "Loading design…"}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
