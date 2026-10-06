import type { BrowserInput, BrowserMethod, BrowserRpcResponse } from './browser.ts';
export const BROWSER_RECEIVER_SCRIPT: string;
export function buildBrowserReceiverScript(): string;
export type BrowserGeometry = { left: number; top: number; width: number; height: number; scale: number };
export function browserGeometry(viewport: { width: number; height: number } | null | undefined, box: { width: number; height: number }): BrowserGeometry | null;
export function browserPoint(point: { x: number; y: number }, geometry: BrowserGeometry | null, clamp?: boolean): { x: number; y: number } | null;
export function createBrowserInputQueue(send: (event: BrowserInput) => Promise<unknown>, failed: (error: Error) => void, limit?: number): { push(event: BrowserInput): void; dispose(): void };
export type TouchGestureHandlers = { tap(point: { x: number; y: number }): void; scroll(dx: number, dy: number, point: { x: number; y: number }): void; pressStart(point: { x: number; y: number }): void; pressMove(point: { x: number; y: number }): void; pressEnd(point: { x: number; y: number }): void };
export function createTouchGesture(handlers: TouchGestureHandlers, timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void }, slop?: number, holdMs?: number): {
  begin(id: number, screen: { x: number; y: number }, point: { x: number; y: number }): boolean;
  move(id: number, screen: { x: number; y: number }, point: { x: number; y: number } | null): void;
  end(id: number, point: { x: number; y: number } | null): void;
  cancel(): void;
  readonly active: boolean;
};
export type BrowserKey = Omit<Extract<BrowserInput, { kind: 'key' }>, 'kind' | 'phase'>;
export function browserKey(event: { key: string; code?: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean }): BrowserKey | null;
export function createBrowserBridge(call: (method: BrowserMethod, args: Record<string, unknown>) => Promise<unknown>, respond: (response: BrowserRpcResponse) => void, transform?: (method: BrowserMethod, result: unknown) => unknown): { receive(message: unknown): Promise<void>; dispose(): void };
/** The same palette the simulator viewer takes. */
export type BrowserTheme = import('./simulator-receiver.d.mts').SimulatorTheme;
export function createBrowserReceiverHtml(config: { chatId: string; targetId: string; theme?: BrowserTheme }): string;
