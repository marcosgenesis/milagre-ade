// Subagent transcripts as a client that reads them on demand holds them (#300, phase 4). A subagent keeps up to 100
// transcript entries, hundreds of KB for a busy one, and the host used to send all of them in every state and in every
// update of a running child. Such a client gets each subagent with only its last entries (`transcript`) and how many it
// has (`transcriptLength`); the panel that shows a whole transcript reads it with chat:subagent and keeps it current
// from the tails that follow. A transcript no longer than the tail goes whole, without `transcriptLength`.

export const TRANSCRIPT_TAIL = 4;
export const TRANSCRIPT_LIMIT = 100;

const tails = new WeakMap();
/** `agent` with only the last entries of its transcript; the same object for the same agent. */
export function withTranscriptTail(agent) {
  if (!Array.isArray(agent?.transcript) || agent.transcript.length <= TRANSCRIPT_TAIL) return agent;
  let tail = tails.get(agent);
  if (!tail) tails.set(agent, (tail = { ...agent, transcript: agent.transcript.slice(-TRANSCRIPT_TAIL), transcriptLength: agent.transcript.length }));
  return tail;
}

const sessions = new WeakMap();
/** `session` with each subagent's transcript cut to its tail; the same object for the same session. */
export function sessionWithTranscriptTails(session) {
  if (!session?.subagents?.some((agent) => agent !== withTranscriptTail(agent))) return session;
  let lean = sessions.get(session);
  if (!lean) sessions.set(session, (lean = { ...session, subagents: session.subagents.map(withTranscriptTail) }));
  return lean;
}

/** Whether `agent` carries only the tail of its transcript. */
export const hasTranscriptTail = (agent) => typeof agent?.transcriptLength === "number";

/**
 * The whole transcript `held` brought up to date with `agent`'s (a tail, or the whole of a short one), as the host
 * merges an update: an entry already held is replaced in place, a new one goes at the end. Null when the result can't
 * be the host's (it doesn't hold as many entries as the host says), so the caller reads it again.
 */
export function mergeTranscript(held, agent) {
  if (!hasTranscriptTail(agent)) return agent?.transcript ?? [];
  const merged = [...new Map([...held, ...agent.transcript].map((entry) => [entry.id, entry])).values()].slice(-TRANSCRIPT_LIMIT);
  const tail = merged.slice(-agent.transcript.length);
  const same = merged.length === agent.transcriptLength && tail.every((entry, index) => entry === agent.transcript[index]);
  return same ? merged : null;
}
