const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { AGENT_NAME, COMMAND, HARNESS, OVERRIDE_ENV, RELEASES, createAntigravity, hasToken, validateAgent } = require("./antigravity-install.cjs");

const skip = process.platform === "win32" ? "needs unzip and a POSIX shell" : false;

// A fake agent: a node script that answers `initialize` like Antigravity.
const agentScript = (name = AGENT_NAME, version = "9.9.9") => `#!/usr/bin/env node
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (const line of buffer.split("\\n").slice(0, -1)) {
    const message = JSON.parse(line);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentInfo: { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} } } }) + "\\n");
  }
  buffer = buffer.slice(buffer.lastIndexOf("\\n") + 1);
});
`;

function makeZip(dir, files) {
  const src = fs.mkdtempSync(path.join(dir, "src-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(src, name), content);
  const zip = path.join(dir, `${crypto.randomUUID()}.zip`);
  execFileSync("/usr/bin/zip", ["-q", "-j", zip, ...Object.keys(files).map((name) => path.join(src, name))]);
  return fs.readFileSync(zip);
}

async function fixture(t, { files, version = "9.9.9", gzip = false, tamper } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-agy-"));
  const entries = files ?? { [COMMAND]: agentScript(AGENT_NAME, version), [HARNESS]: "harness\n" };
  const zip = makeZip(tmp, entries);
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    const body = tamper ? tamper(zip) : zip;
    if (gzip) {
      response.writeHead(200, { "content-encoding": "gzip", "content-type": "application/zip" });
      response.end(zlib.gzipSync(body));
    } else {
      response.writeHead(200, { "content-length": body.length, "content-type": "application/zip" });
      response.end(body);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const key = `${process.platform}-${process.arch}`;
  const release = {
    version,
    url: `http://127.0.0.1:${server.address().port}/agy.zip`,
    bytes: zip.length,
    sha256: crypto.createHash("sha256").update(zip).digest("hex"),
    args: [],
    files: Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, Buffer.byteLength(content)])),
  };
  const dataDir = path.join(tmp, "data");
  const make = (overrides = {}) => createAntigravity({ dataDir, releases: { [key]: release }, env: {}, ...overrides });
  return { tmp, dataDir, release, key, make, requests: () => requests };
}

test("the pinned table lists darwin-arm64 with a full SHA-256 and sizes", () => {
  const release = RELEASES["darwin-arm64"];
  assert.match(release.sha256, /^[0-9a-f]{64}$/);
  assert.equal(release.bytes, 111_456_962);
  assert.deepEqual(Object.keys(release.files).toSorted(), [COMMAND, HARNESS].toSorted());
  assert.equal(Object.keys(RELEASES).length, 1);
});

test("nothing is installed until an install ran; MILAGRE_ANTIGRAVITY_PATH overrides", { skip }, async (t) => {
  const { make, tmp } = await fixture(t);
  assert.equal(make().resolve(), null);
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, COMMAND), "x", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, HARNESS), "x", { mode: 0o755 });
  const found = make({ env: { [OVERRIDE_ENV]: path.join(bin, COMMAND) } }).resolve();
  assert.equal(found.command, path.join(bin, COMMAND));
  assert.equal(found.harness, path.join(bin, HARNESS));
  assert.equal(found.source, "env");
  assert.equal(make({ env: { [OVERRIDE_ENV]: path.join(tmp, "nope", COMMAND) } }).resolve(), null);
});

test("install downloads, verifies, unpacks, validates and activates", { skip }, async (t) => {
  const { make, dataDir, release, key } = await fixture(t);
  const antigravity = make();
  assert.equal(antigravity.updateAvailable(), true);
  const events = [];
  const result = await antigravity.install({ onProgress: (event) => events.push(event) });
  assert.deepEqual(result, { version: "9.9.9", changed: true });
  const found = antigravity.resolve();
  assert.equal(found.version, "9.9.9");
  assert.equal(found.command, path.join(dataDir, "tools", "antigravity", key, "versions", release.sha256, COMMAND));
  assert.equal(fs.statSync(found.command).mode & 0o777, 0o755);
  assert.equal(fs.statSync(found.harness).mode & 0o777, 0o755);
  assert.equal(antigravity.updateAvailable(), false);
  const downloads = events.filter((event) => event.phase === "download");
  assert.equal(downloads.at(-1).received, release.bytes);
  assert.deepEqual(
    events.filter((event) => event.phase !== "download").map((event) => event.phase),
    ["extract", "validate", "done"],
  );
  // Only the version folder and active.json remain.
  assert.deepEqual(fs.readdirSync(path.dirname(path.dirname(found.command))).toSorted(), [release.sha256]);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "tools", "antigravity", key)).toSorted(), ["active.json", "versions"]);
});

test("a gzip-encoded response is verified on its decoded bytes", { skip }, async (t) => {
  const { make } = await fixture(t, { gzip: true });
  const antigravity = make();
  await antigravity.install();
  assert.equal(antigravity.resolve().version, "9.9.9");
});

test("a second install of the active release downloads nothing", { skip }, async (t) => {
  const { make, requests } = await fixture(t);
  const antigravity = make();
  await antigravity.install();
  assert.deepEqual(await antigravity.install(), { version: "9.9.9", changed: false });
  assert.equal(requests(), 1);
});

test("installs at the same time share one download", { skip }, async (t) => {
  const { make, requests } = await fixture(t);
  const seen = [];
  const [a, b] = [
    make().install({ onProgress: (event) => seen.push(["a", event.phase]) }),
    make().install({ onProgress: (event) => seen.push(["b", event.phase]) }),
  ];
  assert.equal(a, b);
  await a;
  assert.equal(requests(), 1);
  assert.ok(seen.some(([who]) => who === "b"));
});

test("a wrong checksum, a short body or a wrong size is refused and leaves nothing behind", { skip }, async (t) => {
  for (const [label, tamper, pattern] of [
    ["checksum", (zip) => Buffer.concat([zip.subarray(0, zip.length - 1), Buffer.from([zip.at(-1) ^ 1])]), /checksum/],
    ["short", (zip) => zip.subarray(0, zip.length - 10), /incomplete/],
    ["long", (zip) => Buffer.concat([zip, Buffer.from("extra")]), /larger than expected/],
  ]) {
    const { make, dataDir, key } = await fixture(t, { tamper });
    const antigravity = make();
    await assert.rejects(antigravity.install(), pattern, label);
    assert.equal(antigravity.resolve(), null);
    const root = path.join(dataDir, "tools", "antigravity", key);
    assert.deepEqual(fs.readdirSync(root), [], label);
  }
});

test("an archive with other entries than the expected two is refused", { skip }, async (t) => {
  const { release } = await fixture(t);
  const files = { [COMMAND]: agentScript(), [HARNESS]: "h\n", "extra.txt": "x" };
  const other = await fixture(t, { files });
  const antigravity = createAntigravity({
    dataDir: other.dataDir,
    releases: { [other.key]: { ...other.release, files: release.files } },
    env: {},
  });
  await assert.rejects(antigravity.install(), /unexpected contents/);
  assert.equal(antigravity.resolve(), null);
});

test("an unpacked file of the wrong size is refused", { skip }, async (t) => {
  const { make, release, key } = await fixture(t);
  const antigravity = make({ releases: { [key]: { ...release, files: { ...release.files, [HARNESS]: 3 } } } });
  await assert.rejects(antigravity.install(), /wrong size/);
  assert.equal(antigravity.resolve(), null);
});

test("an agent that answers as something else, or at another version, is refused", { skip }, async (t) => {
  const wrongName = await fixture(t, { files: { [COMMAND]: agentScript("other-agent", "9.9.9"), [HARNESS]: "h\n" } });
  await assert.rejects(wrongName.make().install(), /isn't Antigravity/);
  assert.equal(wrongName.make().resolve(), null);
  const wrongVersion = await fixture(t);
  const antigravity = wrongVersion.make({ releases: { [wrongVersion.key]: { ...wrongVersion.release, version: "1.0.0" } } });
  await assert.rejects(antigravity.install(), /Expected Antigravity 1.0.0/);
  assert.equal(antigravity.resolve(), null);
});

test("an unsupported platform has no release and refuses to install", async () => {
  const antigravity = createAntigravity({ dataDir: os.tmpdir(), platform: "linux", arch: "mips", env: {} });
  assert.equal(antigravity.supported(), false);
  assert.equal(antigravity.pinned(), null);
  assert.equal(antigravity.resolve(), null);
  await assert.rejects(antigravity.install(), /isn't available for linux mips/);
});

test("an env override is never replaced by an install", { skip }, async (t) => {
  const { make } = await fixture(t);
  const antigravity = make({ env: { [OVERRIDE_ENV]: "/x/agy_acp_server.par" } });
  assert.equal(antigravity.updateAvailable(), false);
  await assert.rejects(antigravity.install(), new RegExp(OVERRIDE_ENV));
});

test("a corrupt active.json counts as not installed", { skip }, async (t) => {
  const { make, dataDir, key } = await fixture(t);
  const root = path.join(dataDir, "tools", "antigravity", key);
  fs.mkdirSync(root, { recursive: true });
  for (const content of ["not json", JSON.stringify({ version: "1", sha256: "../../etc" }), JSON.stringify({ version: "1", sha256: "a".repeat(64) })]) {
    fs.writeFileSync(path.join(root, "active.json"), content);
    assert.equal(make().resolve(), null);
  }
});

test("validateAgent times out on an agent that never answers", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-agy-v-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const silent = path.join(tmp, "silent");
  fs.writeFileSync(silent, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
  await assert.rejects(validateAgent({ command: silent, harness: silent, args: [], cwd: tmp, version: "1", timeoutMs: 200 }), /in time/);
});

test("a profile with acp_token.json is signed in", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-agy-h-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(hasToken(home), false);
  fs.mkdirSync(path.join(home, AGENT_NAME));
  fs.writeFileSync(path.join(home, AGENT_NAME, "acp_token.json"), "{}");
  assert.equal(hasToken(home), true);
});
