import type { AgentEvent } from "@milagre/shared/model";
export interface PowerSaveBlocker {
  start(type: "prevent-app-suspension"): number;
  isStarted(id: number): boolean;
  stop(id: number): void;
}
export class KeepAwake {
  constructor(options: { powerSaveBlocker: PowerSaveBlocker; enabled?: boolean });
  readonly isHolding: boolean;
  turnStarted(chatId: string): void;
  turnEnded(chatId: string): void;
  setupStarted(chatId: string): void;
  setupEnded(chatId: string, options?: { turnFollows?: boolean }): void;
  turnNotStarted(chatId: string): void;
  chatClosed(chatId: string): void;
  observe(chatId: string, event: AgentEvent): void;
  setEnabled(enabled: boolean): void;
  quit(): void;
}
