import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { ImageAttachment } from "../model";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

export function isAttachableImage(file: File): boolean {
  return TYPES.has(file.type) && file.size <= MAX_IMAGE_BYTES;
}

function readImage(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name || "Pasted image", dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error("Could not read the pasted image. Try again."));
    reader.readAsDataURL(file);
  });
}

export function usePastedImages(scope: string) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reading = useRef(false);

  function clear() {
    generation.current++;
    reading.current = false;
    setImages([]);
    setFiles([]);
    setLoading(false);
    setError("");
  }

  useEffect(() => {
    clear();
    return () => { generation.current++; };
  }, [scope]);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setError("");
    if (reading.current) { setError("Wait for the current image to finish loading, then try again."); return; }
    if (files.some((file) => !TYPES.has(file.type))) { setError("Use PNG, JPEG, WebP, or GIF images."); return; }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) { setError("Each image must be 5 MB or smaller."); return; }
    if (images.length + files.length > MAX_IMAGES) { setError("Attach up to 4 images per message."); return; }
    const current = generation.current;
    reading.current = true;
    setLoading(true);
    try {
      const next = await Promise.all(files.map(readImage));
      if (current === generation.current) setImages((existing) => [...existing, ...next]);
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : "Could not read image.");
    } finally {
      if (current === generation.current) { reading.current = false; setLoading(false); }
    }
  }

  async function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    await addFiles(files);
  }

  async function attachFiles(selected: File[]) {
    if (reading.current) { setError("Wait for the current attachment to finish loading, then try again."); return; }
    const current = generation.current;
    reading.current = true;
    setLoading(true);
    setError("");
    const nextImages: ImageAttachment[] = [];
    const paths: string[] = [];
    let failed = false;
    for (const file of selected) {
      try {
        const path = window.milagre.getPathForFile(file);
        if (!path) { failed = true; continue; }
        paths.push(path);
        if (isAttachableImage(file) && images.length + nextImages.length < MAX_IMAGES) {
          try { nextImages.push({ ...await readImage(file), path }); } catch { /* The disk attachment still works. */ }
        }
      } catch { failed = true; }
    }
    if (current !== generation.current) return;
    setFiles(existing => [...new Set([...existing, ...paths])]);
    setImages(existing => [...existing, ...nextImages.filter(image => !existing.some(item => item.path === image.path))]);
    if (failed) setError("Could not get a local path for one or more files. Choose them again with Add files.");
    reading.current = false;
    setLoading(false);
  }

  function removeFile(path: string) {
    setFiles(current => current.filter(file => file !== path));
    setImages(current => current.filter(image => image.path !== path));
  }

  return { images, files, loading, error, onPaste, addFiles, attachFiles, removeFile, clear, remove: (id: string) => setImages((current) => current.filter((image) => image.id !== id)) };
}

export type ImageDraft = ReturnType<typeof usePastedImages>;
