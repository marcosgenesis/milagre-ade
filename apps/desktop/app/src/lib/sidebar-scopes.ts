import { useEffect, useRef, useState } from "react";
import type { CoordinatorState, LinkState } from "@milagre/shared/model";
import type { AgentRuns } from "@milagre/shared/agent-runs";
import { isLinkScopeKey } from "@milagre/shared/chat-scopes";
import { isListedChat } from "@milagre/shared/chats";
import type { SidebarRecent } from "../components/sidebar/ChatRow";
import { chatMark, chatTitle, orderChats, type ChatOrder } from "./chat-list.ts";

/**
 * Chat keys (`<scope>#<id>`, Links included) with a turn streaming, waiting on the user, or asking a question next,
 * each joined by newlines so the memo'd sidebar only re-renders when one changes.
 */
export function runKeys(runs: AgentRuns) {
  const entries = Object.entries(runs);
  const keys = (keep: (run: AgentRuns[string]) => boolean) =>
    entries
      .filter(([, run]) => keep(run))
      .map(([key]) => key)
      .join("\n");
  return {
    running: keys(() => true),
    waiting: keys((run) => run.approvals.length > 0 || run.questions.length > 0),
    asking: keys((run) => run.approvals.length === 0 && run.questions.length > 0),
  };
}

/** The chat rows of a Project or Link that isn't open, for the all-Projects sidebar; the marks come from `runKeys`. */
export function scopeChats(
  key: string,
  state: CoordinatorState | LinkState,
  order: ChatOrder,
  { running, waiting, asking }: { running: Set<string>; waiting: Set<string>; asking: Set<string> },
): SidebarRecent[] {
  const bySession = new Map<number, CoordinatorState["messages"]>();
  for (const message of state.messages) bySession.set(message.session_id, [...(bySession.get(message.session_id) ?? []), message]);
  const listed = Object.values(state.sessions)
    .filter((session) => !session.archived)
    .map((session) => ({ session, sessionMessages: bySession.get(session.id) ?? [] }))
    .filter(({ session, sessionMessages }) => isListedChat(session, sessionMessages.length));
  return orderChats(listed, order).map(({ session, sessionMessages }) => {
    const worktree = "worktree_id" in session && "worktrees" in state ? state.worktrees[session.worktree_id] : undefined;
    const chatKey = `${key}#${session.id}`;
    return {
      id: String(session.id),
      label: chatTitle(session, sessionMessages),
      pinned: Boolean(session.pinned),
      pinOrder: session.pin_order,
      unread: Boolean(session.unread),
      mark: chatMark({ asking: asking.has(chatKey), waiting: waiting.has(chatKey), running: running.has(chatKey), unread: Boolean(session.unread) }),
      ...("worktrees" in session ? { worktreeCount: session.worktrees.length } : {}),
      ...(worktree ? { details: { branch: worktree.name, path: worktree.path, diff: worktree.diff } } : {}),
    };
  });
}

/**
 * Loads each scope's state (a Project path or a `milagre-link:` key) once, without opening it, and follows its
 * later changes. Nothing is read while `enabled` is false.
 */
export function useScopeStates(enabled: boolean, keys: string[]) {
  const [states, setStates] = useState<Record<string, CoordinatorState | LinkState>>({});
  const wanted = useRef(new Set<string>());
  wanted.current = new Set(keys);
  const joined = keys.join("\n");

  useEffect(() => {
    if (!enabled) return;
    const keep = (key: string, state: CoordinatorState | LinkState | undefined) => {
      // A state too large to send arrives without its sessions; the last full one stays.
      if (wanted.current.has(key) && state?.sessions) setStates((previous) => ({ ...previous, [key]: state }));
    };
    const offProject = window.milagre.onProjectState?.(({ path, state }) => keep(path, state));
    const offLink = window.milagre.onLinkState?.(({ linkId, state }) => keep(`milagre-link:${linkId}`, state));
    return () => {
      offProject?.();
      offLink?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !joined) return;
    let live = true;
    for (const key of joined.split("\n")) {
      const read = isLinkScopeKey(key) ? window.milagre.readLink(key.slice("milagre-link:".length)) : window.milagre.readProject(key);
      read.then(
        (opened) => {
          if (live && opened.state?.sessions) setStates((previous) => ({ ...previous, [key]: opened.state }));
        },
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [enabled, joined]);

  return states;
}
