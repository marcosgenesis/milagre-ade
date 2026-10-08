// Moved to @milagre/shared so the desktop's computers (apps/desktop/electron/computers.cjs) pick routes the same way.
import type { RouteSupervisor as SharedSupervisor, RouteSupervisorOptions as SharedOptions } from "@milagre/shared/route-supervisor";
import type { RelayTransport } from "./relay-transport.ts";

export { createRouteSupervisor, PROBE_TIMEOUT, HOLD_MS } from "@milagre/shared/route-supervisor";
export type RouteSupervisor = SharedSupervisor<RelayTransport>;
export type RouteSupervisorOptions = SharedOptions<RelayTransport>;
