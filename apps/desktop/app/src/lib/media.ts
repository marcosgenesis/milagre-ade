export function mediaKind(path: string): "image" | "video" | null {
  const ext = path.split(".").at(-1)?.toLowerCase();
  if (ext && ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"].includes(ext)) return "image";
  if (ext && ["mp4", "mov", "webm", "m4v", "ogv"].includes(ext)) return "video";
  return null;
}
export function mediaUrl(path: string): string {
  return `milagre-media://file/?path=${encodeURIComponent(path)}`;
}
export function attachmentPrompt(body: string, files: string[]): string {
  if (!files.length) return body || "Describe the attached images.";
  return `${body || "Please review the attached files."}\n\nAttached files:\n${files.join("\n")}`;
}

/**
 * Whether main can copy, save or menu this image: a file path always, a data URL (what media:read serves from another
 * Mac) only in the types main's decoder takes. A HEIC or AVIF data URL has no Copy or Save rather than one that fails silently.
 */
export const canCopyImage = (file: string | undefined): file is string =>
  !!file && (!file.startsWith("data:") || /^data:image\/(png|jpeg|webp|gif);base64,/.test(file));
