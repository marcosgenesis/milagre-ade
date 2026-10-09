import { useEffect, useState } from "react";
import { LOCAL_COMPUTER } from "@milagre/shared/chat-scopes";
import type { AgentPort, AgentPorts } from "../model";
import { replaceComputerEntries } from "./agent-runs";

/** Where a port opens in the browser. A server bound only to IPv6 loopback needs its address; "localhost" covers the rest. */
export function portUrl(port: AgentPort) {
  return `http://${port.address === "::1" ? "[::1]" : "localhost"}:${port.port}`;
}

/** Every chat's listening ports, by chat key, on this Mac and on each paired computer. */
export function useAgentPorts() {
  const [ports, setPorts] = useState<AgentPorts>({});
  useEffect(() => {
    // An update that arrives first is newer than the snapshot.
    let live = true;
    let updated = false;
    const mine = (next: AgentPorts) => setPorts((current) => replaceComputerEntries(current, LOCAL_COMPUTER, next));
    const unsubscribe = window.milagre.onAgentPorts((next) => {
      updated = true;
      mine(next);
    });
    const recover = window.milagre.onRuntimeSnapshot?.((snapshot) => {
      updated = true;
      mine(snapshot.ports);
    });
    // A computer's ports arrive keyed by its chat keys (computer-routing.cjs); each replaces only that computer's.
    const remote = window.milagre.onComputerEvent?.((event) => {
      const next = event.channel === "agent:ports" ? event.payload : event.channel === "runtime:snapshot" ? event.payload?.ports : null;
      if (next) setPorts((current) => replaceComputerEntries(current, event.computerId, next));
    });
    void window.milagre
      .getAgentPorts()
      .then((next) => {
        // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
        if (live && !updated) mine(next);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
      recover?.();
      remote?.();
    };
  }, []);
  return ports;
}
