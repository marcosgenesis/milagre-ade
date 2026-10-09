import type { QuestionAnswers, QuestionRequest, Subagent } from "./model.ts";
export type ActivityContent = {
  version: 1;
  updatedAt: number;
  runningCount: number;
  waitingCount: number;
  rows: { title: string; status: string }[];
  question: null | {
    target: string;
    title: string;
    text: string;
    position: number;
    total: number;
    choices: { index: number; label: string }[];
    canAnswer: boolean;
  };
};
export type ActivityChat = { key: string; title: string; working: boolean; subagents?: Pick<Subagent, "id" | "status" | "archived">[] };
export type ActivityPending = {
  target: string;
  chatId: string;
  title: string;
  at: number;
  kind: "question" | "approval";
  request?: QuestionRequest;
  answers?: QuestionAnswers;
};
export type ActivityMode = "all" | "questions";
export function activityContent(input: { chats?: ActivityChat[]; pending?: ActivityPending[]; now?: number; mode?: ActivityMode }): ActivityContent;
