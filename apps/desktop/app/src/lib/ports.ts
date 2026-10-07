import { useEffect, useState } from "react";
import type { AgentPort, AgentPorts } from "../model";

/** Where a port opens in the browser. A server bound only to IPv6 loopback needs its address; "localhost" covers the rest. */
export function portUrl(port: AgentPort) {
  return `http://${port.address === "::1" ? "[::1]" : "localhost"}:${port.port}`;
}

/** Every chat's listening ports, by chat key, as the main process finds them. */
export function useAgentPorts() {
  const [ports, setPorts] = useState<AgentPorts>({});
  useEffect(() => {
    // An update that arrives first is newer than the snapshot.
    let live = true;
    let updated = false;
    const unsubscribe = window.milagre.onAgentPorts((next) => {
      updated = true;
      setPorts(next);
    });
    const recover = window.milagre.onRuntimeSnapshot?.((snapshot) => {
      updated = true;
      setPorts(snapshot.ports);
    });
    // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
    void window.milagre
      .getAgentPorts()
      .then((next) => {
        if (live && !updated) setPorts(next);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
      recover?.();
    };
  }, []);
  return ports;
}
