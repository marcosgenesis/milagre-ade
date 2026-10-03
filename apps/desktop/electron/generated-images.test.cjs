const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { copyImage, requireImage, saveImage } = require("./generated-images.cjs");

async function scratch(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-generated-images-")));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return base;
}

test("only an absolute path to an image file is accepted", async (t) => {
  const base = await scratch(t);
  const image = path.join(base, "ig.png");
  await fs.writeFile(image, "png");
  await fs.writeFile(path.join(base, "notes.txt"), "secret");
  await fs.symlink(path.join(base, "notes.txt"), path.join(base, "fake.png"));
  assert.equal(await requireImage(image), image);
  await assert.rejects(requireImage("ig.png"), /Not an image/);
  await assert.rejects(requireImage(path.join(base, "notes.txt")), /Not an image/);
  await assert.rejects(requireImage(path.join(base, "fake.png")), /Not an image/);
  await assert.rejects(requireImage(path.join(base, "missing.png")));
});

test("copyImage puts the image on the clipboard", async (t) => {
  const base = await scratch(t);
  const image = path.join(base, "ig.png");
  await fs.writeFile(image, "png");
  const written = [];
  await copyImage(image, { createFromPath: (file) => ({ file, isEmpty: () => false }), writeImage: (value) => written.push(value.file) });
  assert.deepEqual(written, [image]);
  await assert.rejects(copyImage(image, { createFromPath: () => ({ isEmpty: () => true }), writeImage: () => {} }), /Couldn't read/);
});

test("saveImage copies the image where the user picks, starting in Downloads", async (t) => {
  const base = await scratch(t);
  const image = path.join(base, "ig.png");
  await fs.writeFile(image, "png bytes");
  const target = path.join(base, "saved.png");
  let options;
  assert.equal(await saveImage(image, { downloads: "/Users/me/Downloads", showSaveDialog: async (value) => { options = value; return { canceled: false, filePath: target }; } }), target);
  assert.equal(options.defaultPath, "/Users/me/Downloads/ig.png");
  assert.deepEqual(options.filters, [{ name: "Image", extensions: ["png"] }]);
  assert.equal(await fs.readFile(target, "utf8"), "png bytes");
  assert.equal(await saveImage(image, { downloads: base, showSaveDialog: async () => ({ canceled: true }) }), null);
});
