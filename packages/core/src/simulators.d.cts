export type SimulatorOrientation = "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
export interface SimulatorDevice {
  id: string;
  name: string;
  platform: "ios";
  version: string;
}
export interface SimulatorIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
export interface SimulatorStatus {
  width: number;
  height: number;
  orientation: SimulatorOrientation;
  generation: number;
  controlling: boolean;
  ready: boolean;
}
export type SimulatorInput =
  | { kind: "touch"; phase: "begin" | "move" | "end"; points: { x: number; y: number }[] }
  | { kind: "button"; button: "home" }
  | { kind: "rotate"; orientation: SimulatorOrientation }
  | { kind: "key"; phase: "down" | "up"; usage: number; key?: string; shifted?: boolean };
export interface SimulatorChannel {
  status(): Omit<SimulatorStatus, "generation" | "controlling"> & { error?: string };
  send(event: SimulatorInput): void;
  close(): Promise<void>;
}
export interface SimulatorAdapter {
  iceServers?: SimulatorIceServer[];
  list(): Promise<SimulatorDevice[]>;
  connect(deviceId: string): Promise<SimulatorChannel>;
  offer(deviceId: string, sessionId: string, sdp: string): Promise<{ type: "answer"; sdp: string }>;
  closeViewer(deviceId: string, sessionId: string): Promise<void>;
  stop(): Promise<void>;
}
export interface SimulatorOptions {
  /** Trusted host configuration only; never populate from RPC arguments. */
  helperPath?: string;
  adapter?: SimulatorAdapter;
  iceServers?: SimulatorIceServer[];
  supported?: boolean;
  viewerTtlMs?: number;
  maxViewers?: number;
  now?: () => number;
}
export interface Simulators {
  list(): Promise<{ devices: SimulatorDevice[]; supported: boolean; error?: string }>;
  open(request: { deviceId: string }, owner: string): Promise<{ viewerId: string; device: SimulatorDevice; iceServers: SimulatorIceServer[] }>;
  offer(request: { viewerId: string; sdp: string }, owner: string): Promise<{ type: "answer"; sdp: string }>;
  status(request: { viewerId: string }, owner: string): Promise<SimulatorStatus>;
  control(request: { viewerId: string; takeOver: boolean }, owner: string): Promise<SimulatorStatus>;
  input(request: { viewerId: string; sequence: number; generation: number; event: SimulatorInput }, owner: string): Promise<{ accepted: boolean }>;
  closeViewer(request: { viewerId: string }, owner: string): Promise<null>;
  disconnect(owner: string): Promise<void>;
  close(): Promise<void>;
}
export function createSimulators(options?: SimulatorOptions): Simulators;
