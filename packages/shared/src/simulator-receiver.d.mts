import type { SimulatorInput, SimulatorMethod, SimulatorRpcResponse } from "./simulator.ts";
export const SIMULATOR_RECEIVER_SCRIPT: string;
export function buildSimulatorReceiverScript(): string;
export type SimulatorGeometry = { left: number; top: number; width: number; height: number; rawWidth: number; rawHeight: number; rotation: number };
export function simulatorGeometry(
  status: { width: number; height: number; orientation: string },
  box: { width: number; height: number },
): SimulatorGeometry | null;
export function simulatorPoint(point: { x: number; y: number }, geometry: SimulatorGeometry | null, clamp?: boolean): { x: number; y: number } | null;
export function createSimulatorInputQueue(
  send: (event: SimulatorInput) => Promise<unknown>,
  failed: (error: Error) => void,
  limit?: number,
): { push(event: SimulatorInput): void; dispose(): void };
export function createSimulatorBridge(
  call: (method: SimulatorMethod, args: Record<string, unknown>) => Promise<unknown>,
  respond: (response: SimulatorRpcResponse) => void,
): { receive(message: unknown): Promise<void>; dispose(): void };
export type SimulatorTheme = { scheme: "light" | "dark"; surface: string; ink: string; ink2: string; line: string; hover: string; accent: string };
export function createSimulatorReceiverHtml(config: { deviceId: string; theme?: SimulatorTheme }): string;
