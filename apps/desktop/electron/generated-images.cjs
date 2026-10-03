const fs = require("node:fs/promises");
const path = require("node:path");

// image:copy, image:save and image:menu. The renderer names the image by path, so only an absolute path
// to a regular image file is accepted (checked on the resolved target, so a .png symlink can't stand in
// for another kind of file).
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

async function requireImage(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error("Not an image file.");
  const real = await fs.realpath(file);
  if (!IMAGE_EXTENSIONS.has(path.extname(real).toLowerCase()) || !(await fs.stat(real)).isFile()) throw new Error("Not an image file.");
  return real;
}

// Puts the image itself on the clipboard, so it pastes as an image.
async function copyImage(file, { createFromPath, writeImage }) {
  const image = createFromPath(await requireImage(file));
  if (image.isEmpty()) throw new Error("Couldn't read the image.");
  writeImage(image);
}

// Asks where to save a copy, starting in Downloads with the image's own name. Returns the saved path, or null when cancelled.
async function saveImage(file, { showSaveDialog, downloads }) {
  const source = await requireImage(file);
  const extension = path.extname(source).slice(1).toLowerCase();
  const { canceled, filePath } = await showSaveDialog({ defaultPath: path.join(downloads, path.basename(file)), filters: [{ name: "Image", extensions: [extension] }] });
  if (canceled || !filePath) return null;
  await fs.copyFile(source, filePath);
  return filePath;
}

module.exports = { copyImage, requireImage, saveImage };
