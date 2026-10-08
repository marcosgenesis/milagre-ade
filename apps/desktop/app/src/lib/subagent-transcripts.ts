import { useEffect, useReducer, useRef } from "react";
import { projectOfKey, sessionIdFromKey } from "@milagre/shared/agent-runs";
import { hasTranscriptTail, mergeTranscript } from "@milagre/shared/subagent-transcript";
import type { Subagent, SubagentTranscriptEntry } from "../model.ts";

// The whole transcripts of the subagents a panel shows, from a host that sends each subagent with only the end of its
// transcript (subagent-tails-v1): read once with readSubagent, then kept current from the tails each update brings.

type Whole = { agent: Subagent; transcript: SubagentTranscriptEntry[] };
const KEPT = 16;
// `${chatKey}|${agentId}` -> the agent last merged and its whole transcript, the last ones shown kept.
const wholes = new Map<string, Whole>();
const loads = new Map<string, Promise<void>>();

function remember(key: string, whole: Whole) {
  wholes.delete(key);
  wholes.set(key, whole);
  if (wholes.size > KEPT) wholes.delete(wholes.keys().next().value!);
}

/** The whole transcript of `agent` as far as it is known; null when it has to be read. */
function known(key: string, agent: Subagent): SubagentTranscriptEntry[] | null {
  // A transcript that comes whole is the start of the one its later tails extend.
  if (!hasTranscriptTail(agent)) {
    if (wholes.get(key)?.agent !== agent) remember(key, { agent, transcript: agent.transcript });
    return agent.transcript;
  }
  const whole = wholes.get(key);
  if (!whole) return null;
  if (whole.agent === agent) return whole.transcript;
  const merged = mergeTranscript(whole.transcript, agent);
  if (merged) remember(key, { agent, transcript: merged });
  return merged;
}

function load(key: string, chatKey: string, latest: () => Subagent) {
  let loading = loads.get(key);
  if (!loading) {
    loading = window.milagre
      .readSubagent(projectOfKey(chatKey), sessionIdFromKey(chatKey), latest().id)
      .then(
        (read) => {
          // The update shown may be newer than the read: its tail goes on top when it fits, and the read stands when not.
          const agent = latest();
          remember(key, { agent, transcript: mergeTranscript(read.transcript, agent) ?? read.transcript });
        },
        () => remember(key, { agent: latest(), transcript: latest().transcript }),
      )
      .finally(() => loads.delete(key));
    loads.set(key, loading);
  }
  return loading;
}

/** The whole transcript of subagent `agent` of Chat `chatKey`: its tail until the rest is read. */
export function useSubagentTranscript(chatKey: string | null | undefined, agent: Subagent): SubagentTranscriptEntry[] {
  const [, loaded] = useReducer((count: number) => count + 1, 0);
  const latest = useRef(agent);
  latest.current = agent;
  const key = chatKey ? `${chatKey}|${agent.id}` : null;
  const transcript = key ? known(key, agent) : agent.transcript;
  const missing = Boolean(key && !transcript);
  useEffect(() => {
    if (!key || !missing) return;
    let current = true;
    void load(key, chatKey!, () => latest.current).then(() => current && loaded());
    return () => {
      current = false;
    };
  }, [key, chatKey, missing, agent]);
  return transcript ?? agent.transcript;
}
