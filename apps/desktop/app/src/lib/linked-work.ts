import { useEffect, useState } from "react";
import type { LinkedWork } from "../model";
import { chatInProject, sessionIdFromKey } from "@milagre/shared/agent-runs";

export const NO_LINKED_WORK: LinkedWork = { delegations: [], negotiations: [], receiveOnly: [] };

/** The Delegations and Negotiations open across Links, kept current from the main process. */
export function useLinkedWork(): LinkedWork {
  const [work, setWork] = useState<LinkedWork>(NO_LINKED_WORK);
  useEffect(() => {
    let live = true;
    // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node callback (or deliberately bridges the promise to a callback API)
    window.milagre.getLinkedWork().then((next) => { if (live) setWork(next); }, () => {});
    const off = window.milagre.onLinkedWork(setWork);
    return () => { live = false; off(); };
  }, []);
  return work;
}

/** The project's Chats (by session id) a Delegation is queued or running for: their sidebar row gets a mark. */
export function delegatedChats(work: LinkedWork, projectPath: string): Set<number> {
  return new Set(work.delegations.flatMap((item) => (item.to_chat && chatInProject(projectPath, item.to_chat) ? [sessionIdFromKey(item.to_chat)] : [])));
}
