const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readMedia, MAX_MEDIA } = require("./media-access.cjs");

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

async function scope(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "media-access-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const dataDir = path.join(root, "data");
  await fs.mkdir(path.join(project, ".milagre", "images"), { recursive: true });
  await fs.mkdir(path.join(root, "home", ".ssh"), { recursive: true });
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(project, ".milagre", "images", "shot.png"), PNG);
  await fs.writeFile(path.join(project, "fake.png"), "not an image at all");
  await fs.writeFile(path.join(root, "home", ".ssh", "id_rsa.png"), "-----BEGIN OPENSSH PRIVATE KEY-----");
  await fs.writeFile(path.join(root, "shared.png"), PNG);
  await fs.symlink(path.join(root, "home", ".ssh", "id_rsa.png"), path.join(project, "link.png"));
  const big = await fs.open(path.join(project, "big.png"), "w");
  await big.write(PNG, 0, PNG.length, 0);
  await big.truncate(MAX_MEDIA + 1);
  await big.close();
  const options = {
    dataDir,
    scopeRoots: async () => [project],
    // As project:chat-image: an image a reply shared is copied into .milagre/images and that copy is served.
    chatImage: async (_scope, requested) => (requested === path.join(root, "shared.png") ? path.join(project, ".milagre", "images", "shot.png") : null),
  };
  return { root, project, options };
}

test("an image a scope's chat shows is read with its type, by the phone's rules", async (t) => {
  const { project, root, options } = await scope(t);
  const read = await readMedia({ scope: project, path: path.join(project, ".milagre", "images", "shot.png") }, options);
  assert.deepEqual({ type: read.type, size: read.size }, { type: "image/png", size: PNG.length });
  assert.deepEqual(Buffer.from(read.base64, "base64"), PNG);
  assert.equal((await readMedia({ scope: project, path: path.join(root, "shared.png") }, options)).type, "image/png", "an image a reply shared");
});

test("anything the phone can't get is refused, and no bytes leave", async (t) => {
  const { project, root, options } = await scope(t);
  const refused = async (request, code) => assert.rejects(readMedia(request, options), { code }, JSON.stringify(request));
  await refused({ scope: project, path: path.join(root, "home", ".ssh", "id_rsa.png") }, "NOT_SERVED");
  await refused({ scope: project, path: path.join(project, "link.png") }, "NOT_SERVED");
  await refused({ scope: project, path: path.join(project, "fake.png") }, "NOT_AN_IMAGE");
  await refused({ scope: project, path: path.join(project, "notes.txt") }, "NOT_AN_IMAGE");
  await refused({ scope: project, path: path.join(project, "big.png") }, "TOO_LARGE");
  await refused({ scope: project, path: path.join(project, ".milagre", "images", "gone.png") }, "NOT_FOUND");
  await refused({ scope: project, path: "shot.png" }, "BAD_REQUEST");
  await refused({ scope: "relative", path: path.join(project, "x.png") }, "BAD_REQUEST");
});
