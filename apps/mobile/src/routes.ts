import type { RelayTransport } from "./relay-transport.ts";
import type { LanRoute } from "./lan-route.ts";

export const PROBE_TIMEOUT = 2_500;
/** An endpoint that answered its probe but would not open waits this long before it is tried again. */
export const HOLD_MS = 5 * 60_000;

export type ActiveRoute = { kind: "primary" } | { kind: "lan"; endpoint: string; transport: RelayTransport };
export type RouteSupervisor = {
  current(): ActiveRoute;
  /** Moves to the best route that works now: a LAN endpoint if one answers and opens, else the paired route. */
  check(): Promise<ActiveRoute>;
  /** The app is going to the background: closes the LAN socket and falls back to the paired route; the next check reopens it. */
  suspend(): void;
  subscribe(listener: (route: ActiveRoute) => void): () => void;
  close(): void;
};
export type RouteSupervisorOptions = {
  lan: () => LanRoute | undefined;
  probe: (endpoint: string, hostId: string) => Promise<boolean>;
  openLan: (endpoint: string, lan: LanRoute, onLost: () => void) => Promise<RelayTransport>;
  now?: () => number;
};
const PRIMARY: ActiveRoute = { kind: "primary" };

/** A transport that fails to close must not stop the supervisor from moving on. */
function closeQuietly(transport: RelayTransport) {
  try {
    transport.close();
  } catch {
    /* already going away */
  }
}

/** Which way one computer is reached: its LAN endpoints when they work, its paired route (Cloudflare or relay) otherwise. */
export function createRouteSupervisor({ lan, probe, openLan, now = Date.now }: RouteSupervisorOptions): RouteSupervisor {
  let active: ActiveRoute = PRIMARY;
  let walking: Promise<ActiveRoute> | null = null;
  let closed = false;
  const held = new Map<string, number>();
  const listeners = new Set<(route: ActiveRoute) => void>();

  function set(next: ActiveRoute) {
    const previous = active;
    if (previous === next) return;
    active = next;
    // The copy is deliberate: a listener may (un)subscribe during notification, and a live Set would revisit it.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* a listener must not stop the switch */
      }
    }
    if (previous.kind === "lan") closeQuietly(previous.transport);
  }

  /** Falls back to the paired route and, unless the supervisor is closed, tries the advertised endpoints again. */
  function lost() {
    set(PRIMARY);
    if (!closed) void supervisor.check().catch(() => {});
  }

  async function walk(): Promise<ActiveRoute> {
    const route = lan();
    if (active.kind === "lan") {
      const current = active;
      const { endpoint } = current;
      const answered = route?.endpoints.includes(endpoint) && (await probe(endpoint, route.hostId).catch(() => false));
      if (closed) return active;
      // Demoted while probing (suspend or a lost socket): that transport is closed, and ready() would reopen it.
      // The endpoint did nothing wrong, so it is neither asked nor held; the walk below tries it like any other.
      if (active === current) {
        if (answered) {
          // A socket that answers its probe can still be dead: the supervisor only counts it once its hello has finished.
          const ready = await current.transport.ready().then(
            () => true,
            () => false,
          );
          if (closed) return active;
          // Demoted during ready() too: its failure is the demotion's doing, not the endpoint's.
          if (active === current) {
            if (ready) return active;
            held.set(endpoint, now() + HOLD_MS);
          }
        }
        if (active === current) set(PRIMARY);
      }
    }
    if (!route) return active;
    const candidates = route.endpoints.filter((endpoint) => (held.get(endpoint) ?? 0) <= now());
    const probes = candidates.map((endpoint) => probe(endpoint, route.hostId).catch(() => false));
    for (const [index, endpoint] of candidates.entries()) {
      if (!(await probes[index]) || closed) continue;
      let opened: RelayTransport | undefined;
      try {
        opened = await openLan(endpoint, route, () => {
          // Only the transport that was opened for this callback can demote the route: a replaced one reports late.
          if (opened && active.kind === "lan" && active.transport === opened) lost();
        });
      } catch {
        held.set(endpoint, now() + HOLD_MS);
        continue;
      }
      if (closed) {
        closeQuietly(opened);
        return active;
      }
      set({ kind: "lan", endpoint, transport: opened });
      return active;
    }
    return active;
  }

  const supervisor: RouteSupervisor = {
    current: () => active,
    check() {
      if (closed) return Promise.resolve(active);
      walking ??= walk().finally(() => {
        walking = null;
      });
      return walking;
    },
    suspend() {
      set(PRIMARY);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
      const previous = active;
      active = PRIMARY;
      if (previous.kind === "lan") closeQuietly(previous.transport);
    },
  };
  return supervisor;
}
