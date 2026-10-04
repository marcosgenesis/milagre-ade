export const MAX_IMAGES = 4;
/** A Negotiation stops after this many Delegations between its two Chats. */
export const NEGOTIATION_ROUNDS = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const IMAGE_ERRORS = Object.freeze({
  count: `Attach up to ${MAX_IMAGES} images per message.`,
  size: `Each image must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`,
  type: "Use PNG, JPEG, WebP, or GIF images.",
});
