import { localEndpoint, relayAddress, validAccess, validRelay, type Access, type RelayLink } from "./client.ts";

export type Pairing = { address: string; token: string; name: string; access?: Access; relay?: RelayLink };

/** Reads the link the host prints and encodes in its QR code: a direct address (scripts/mobile-pairing.cjs) or the relay (apps/daemon/src/mobile-pairing.cjs). */
export function parsePairing(input: string): Pairing {
  // React Native's URL does not parse custom schemes or query strings, so the link is read by hand.
  const match = /^milagre(?:-local)?:\/\/\/?pair\/?\?(.*)$/i.exec(input.trim());
  if (!match) throw new Error("That is not a Milagre pairing link. Scan the code your Mac shows, or copy its pairing link.");
  const params: Record<string, string> = {};
  for (const part of match[1].split("&")) {
    const [key, ...value] = part.split("=");
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value.join("=").replace(/\+/g, " "));
    } catch {
      /* skip a malformed pair */
    }
  }
  const token = params.token || "";
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("This pairing link has no valid token. Restart the host on your Mac and scan the new code.");
  if (params.relay !== undefined || params.host !== undefined || params.key !== undefined) {
    // A link names one way to reach the Mac; one with both was not made by Milagre.
    if (params.address !== undefined) throw new Error("This pairing link is damaged. Scan the code again in Settings → Devices on your Mac.");
    const relay = validRelay({ url: params.relay, hostId: params.host, key: params.key });
    return { address: relayAddress(relay.hostId), token, name: (params.name || "").trim().slice(0, 80) || "Mac", relay };
  }
  const address = localEndpoint(params.address || "");
  const name = (params.name || "").trim().slice(0, 80) || address.replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
  const access = validAccess({ id: params.cfId, secret: params.cfSecret });
  if (access && !address.startsWith("https:")) throw new Error("This pairing link has a Cloudflare token but no HTTPS address.");
  return access ? { address, token, name, access } : { address, token, name };
}
