import type { QuestionAnswers } from "@milagre/shared/model";

// Navigation handoff only. Daemon owns the draft and validates its request identity.
const drafts = new Map<string, { requestId: string; answers: QuestionAnswers }>();
const key = (hostId: string, projectPath: string, sessionId: number) => JSON.stringify([hostId, projectPath, sessionId]);
export function holdActivityDraft(hostId: string, projectPath: string, sessionId: number, requestId: string, answers: QuestionAnswers) {
  if (drafts.size >= 32) drafts.delete(drafts.keys().next().value!);
  drafts.set(key(hostId, projectPath, sessionId), { requestId, answers });
}
export function takeActivityDraft(hostId: string, projectPath: string, sessionId: number, requestId: string): QuestionAnswers {
  const id = key(hostId, projectPath, sessionId);
  const held = drafts.get(id);
  drafts.delete(id);
  return held?.requestId === requestId ? held.answers : {};
}
