const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createMediaHandler } = require("./media.cjs");

test("media streams byte ranges, rejects nonmedia and symlinks to nonmedia", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-media-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "clip #1.MP4"), "video");
  await fs.writeFile(path.join(dir, "secret.txt"), "secret");
  await fs.symlink(path.join(dir, "secret.txt"), path.join(dir, "fake.png"));
  const calls = [];
  const handle = createMediaHandler(async (url, options) => {
    calls.push({ url, options });
    return new Response("video");
  });
  const request = (name, range) =>
    new Request(`milagre-media://file/?path=${encodeURIComponent(path.join(dir, name))}`, { headers: range ? { Range: range } : {} });
  assert.equal((await handle(request("clip #1.MP4"))).status, 200);
  assert.ok(calls[0].url.endsWith("clip%20%231.MP4"));
  for (const [range, expected, contentRange] of [
    ["bytes=1-3", "ide", "bytes 1-3/5"],
    ["bytes=-2", "eo", "bytes 3-4/5"],
    ["bytes=2-", "deo", "bytes 2-4/5"],
  ]) {
    const response = await handle(request("clip #1.MP4", range));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(await response.text(), expected);
  }
  for (const range of ["bytes=99-", "bytes=3-1", "nonsense", "bytes=0-1,3-4"]) assert.equal((await handle(request("clip #1.MP4", range))).status, 416);
  for (const name of ["secret.txt", "fake.png", "missing.png"]) assert.equal((await handle(request(name))).status, 404);
  assert.equal((await handle(new Request("milagre-media://other/?path=/tmp/a.png"))).status, 404);
  assert.equal(calls.length, 1);
});
