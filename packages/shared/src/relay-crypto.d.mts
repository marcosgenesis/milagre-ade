export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };
export type Channel = {
  seal(value: unknown): Uint8Array;
  open(frame: Uint8Array): unknown;
};
export type Random = (n: number) => Uint8Array;
export type RelayAuthCode = "unknown-phone" | "bad-token" | "bad-hello";

export class RelayAuthError extends Error {
  code: RelayAuthCode;
  constructor(code: RelayAuthCode, message: string);
}

export function b64url(bytes: Uint8Array): string;
export function fromB64url(text: string): Uint8Array;
export function boxKeyPair(random: Random): KeyPair;
export function signKeyPair(random: Random): KeyPair;
export function hostIdOf(signPublicKey: Uint8Array): string;
export function phoneHello(args: { phone: KeyPair; host: Uint8Array; token: string; random: Random }): { message: Uint8Array; ephemeral: KeyPair };
export function hostAccept(args: {
  host: KeyPair;
  hello: Uint8Array;
  isKnown: (phoneKey: string) => boolean;
  canPair?: boolean;
  token: string;
  random: Random;
}): { reply: Uint8Array; channel: Channel; phoneKey: string; firstPairing: boolean };
export function phoneFinish(args: { ephemeral: KeyPair; phone: KeyPair; host: Uint8Array; reply: Uint8Array }): Channel;
