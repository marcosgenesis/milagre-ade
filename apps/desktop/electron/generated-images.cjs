const fs = require("node:fs/promises");
const path = require("node:path");

// image:copy, image:save and image:menu. The renderer names the image by path, so only an absolute path
// to a regular image file is accepted (checked on the resolved target, so a .png symlink can't stand in
// for another kind of file). A pasted image has no file, so it comes as a base64 image data URL instead.
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

// The bytes of a base64 image data URL, or null when `source` isn't one.
function imageData(source) {
  const match = typeof source === "string" && /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  return match ? { extension: match[1] === "jpeg" ? "jpg" : match[1], bytes: Buffer.from(match[2], "base64") } : null;
}

async function requireImage(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error("Not an image file.");
  const real = await fs.realpath(file);
  if (!IMAGE_EXTENSIONS.has(path.extname(real).toLowerCase()) || !(await fs.stat(real)).isFile()) throw new Error("Not an image file.");
  return real;
}

// Puts the image itself on the clipboard, so it pastes as an image.
async function copyImage(file, { createFromPath, createFromBuffer, writeImage }) {
  const data = imageData(file);
  const image = data ? createFromBuffer(data.bytes) : createFromPath(await requireImage(file));
  if (image.isEmpty()) throw new Error("Couldn't read the image.");
  await writeImage(image);
}

// Asks where to save a copy, starting in Downloads with the image's own name (`name` for a data URL).
// Returns the saved path, or null when cancelled.
async function saveImage(file, { showSaveDialog, downloads }, name = "Pasted image") {
  const data = imageData(file);
  const source = data ? "" : await requireImage(file);
  const extension = data ? data.extension : path.extname(source).slice(1).toLowerCase();
  const base = data ? `${path.basename(String(name)).replace(/\.[^.]*$/, "") || "Pasted image"}.${extension}` : path.basename(file);
  const { canceled, filePath } = await showSaveDialog({ defaultPath: path.join(downloads, base), filters: [{ name: "Image", extensions: [extension] }] });
  if (canceled || !filePath) return null;
  if (data) await fs.writeFile(filePath, data.bytes);
  else await fs.copyFile(source, filePath);
  return filePath;
}

module.exports = { copyImage, imageData, requireImage, saveImage };
