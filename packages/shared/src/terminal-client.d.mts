import type { TerminalApi, TerminalInfo } from "./terminal.ts";

export type TerminalFollower = {
  send(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
  readonly stopped: boolean;
};

export function followTerminal(options: {
  terminalId: string;
  api: Pick<TerminalApi, "read" | "input" | "resize">;
  write(data: string): void;
  reset(data: string): void;
  ended?(): void;
  info?(terminal: TerminalInfo): void;
  retryMs?: number;
  wait?(ms: number): Promise<void>;
}): TerminalFollower;
