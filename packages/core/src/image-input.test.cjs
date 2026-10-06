const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeImages } = require("./image-input.cjs");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";
const image = { id: "one", name: "pasted.png", dataUrl: `data:image/png;base64,${png}` };

test("validates pasted images and rejects unsupported or excessive attachments", () => {
  assert.equal(decodeImages([image])[0].mime, "image/png");
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- pre-existing, see PR body
  assert.throws(() => decodeImages(Array(5).fill(image)), /up to 4/);
  assert.throws(() => decodeImages([{ dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }]), /PNG/);
  assert.throws(() => decodeImages([{ dataUrl: "data:image/png;base64,aGVsbG8=" }]), /valid supported image/);
  assert.throws(() => decodeImages([{ dataUrl: "x".repeat(8 * 1024 * 1024) }]), /5 MB/);
});
