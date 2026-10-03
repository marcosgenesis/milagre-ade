import { localEndpoint } from './client.ts';

export type Pairing = { address: string; token: string; name: string };

/** Reads the link the host prints and encodes in its QR code (scripts/mobile-pairing.cjs). */
export function parsePairing(input: string): Pairing {
  // React Native's URL does not parse custom schemes or query strings, so the link is read by hand.
  const match = /^milagre(?:-local)?:\/\/\/?pair\/?\?(.*)$/i.exec(input.trim());
  if (!match) throw new Error('That is not a Milagre pairing link. Scan the code your Mac shows, or copy its pairing link.');
  const params: Record<string, string> = {};
  for (const part of match[1].split('&')) {
    const [key, ...value] = part.split('=');
    try { params[decodeURIComponent(key)] = decodeURIComponent(value.join('=').replace(/\+/g, ' ')); } catch { /* skip a malformed pair */ }
  }
  const token = params.token || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('This pairing link has no valid token. Restart the host on your Mac and scan the new code.');
  const address = localEndpoint(params.address || '');
  const name = (params.name || '').trim().slice(0, 80) || address.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
  return { address, token, name };
}
