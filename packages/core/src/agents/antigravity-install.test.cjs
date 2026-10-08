const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFile, execFileSync } = require("node:child_process");
const {
  AGENT_NAME,
  COMMAND,
  HARNESS,
  OVERRIDE_ENV,
  RELEASES,
  archiveCommands,
  argsFor,
  createAntigravity,
  hasToken,
  memberNames,
  validateAgent,
} = require("./antigravity-install.cjs");
const { antigravityEnv, antigravitySpawn } = require("./antigravity-acp.cjs");

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
});

// Hashes, sizes and member sizes were taken from the downloaded archives and match the ones T3 Code pins.
const PINNED = {
  "darwin-arm64": { dir: "macos", file: "darwin-arm64", sha256: "7cd97045", bytes: 111_456_962, sizes: [278_535_456, 118_611_392] },
  "darwin-x64": { dir: "macos", file: "darwin-x86_64", sha256: "bb23956b", bytes: 117_245_544, sizes: [282_840_688, 124_175_392] },
  "linux-x64": { dir: "linux", file: "linux-x86_64", sha256: "9fb60956", bytes: 333_727_150, sizes: [926_533_965, 130_388_040] },
  "linux-arm64": { dir: "linux", file: "linux-arm64", sha256: "500b0bc0", bytes: 321_690_363, sizes: [930_848_992, 123_224_968] },
  "win32-x64": { dir: "windows", file: "windows-x86_64", sha256: "65215e06", bytes: 124_509_787, sizes: [81_437_336, 145_548_952] },
  "win32-arm64": { dir: "windows", file: "windows-arm64", sha256: "4a0f4697", bytes: 124_654_803, sizes: [85_893_472, 135_640_216] },
};

test("every platform the registry lists for 1.3.0 is pinned, with its own member names", () => {
  assert.deepEqual(Object.keys(RELEASES).toSorted(), Object.keys(PINNED).toSorted());
  for (const [key, expected] of Object.entries(PINNED)) {
    const release = RELEASES[key];
    const platform = key.split("-")[0];
    assert.equal(release.version, "1.3.0", key);
    assert.equal(release.url, `https://dl.google.com/agy-extensions/releases/${expected.dir}/agy-acp-server-1.3.0-${expected.file}.zip`, key);
    assert.match(release.sha256, /^[0-9a-f]{64}$/, key);
    assert.ok(release.sha256.startsWith(expected.sha256), key);
    assert.equal(release.bytes, expected.bytes, key);
    const names = memberNames(platform);
    assert.deepEqual(release.files, { [names.command]: expected.sizes[0], [names.harness]: expected.sizes[1] }, key);
    assert.deepEqual([...release.args], platform === "linux" ? ["--uid="] : [], key);
    assert.ok(Object.isFrozen(release), key);
  }
  assert.equal(new Set(Object.values(RELEASES).map((release) => release.sha256)).size, 6);
  assert.deepEqual(memberNames("win32"), { command: "agy_acp_server.exe", harness: "localharness_external.exe" });
  assert.deepEqual(memberNames("darwin"), { command: COMMAND, harness: HARNESS });
  assert.deepEqual(memberNames("linux"), { command: COMMAND, harness: HARNESS });
  assert.deepEqual([...argsFor("linux")], ["--uid="]);
  assert.deepEqual([...argsFor("darwin")], []);
});

test("every pinned platform is supported and reports its pinned release", () => {
  for (const [key, release] of Object.entries(RELEASES)) {
    const [platform, arch] = key.split("-");
    const antigravity = createAntigravity({ dataDir: os.tmpdir(), platform, arch, env: {} });
    assert.equal(antigravity.supported(), true, key);
    assert.deepEqual(antigravity.pinned(), { version: "1.3.0", sha256: release.sha256, bytes: release.bytes }, key);
  }
});

test("resolve finds the platform's own file names and arguments", () => {
  for (const [key, release] of Object.entries(RELEASES)) {
    const [platform, arch] = key.split("-");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-agy-r-"));
    try {
      const root = path.join(dataDir, "tools", "antigravity", key);
      const folder = path.join(root, "versions", release.sha256);
      fs.mkdirSync(folder, { recursive: true });
      const names = memberNames(platform);
      const antigravity = createAntigravity({ dataDir, platform, arch, env: {} });
      assert.equal(antigravity.resolve(), null, key);
      fs.writeFileSync(path.join(root, "active.json"), JSON.stringify({ version: "1.3.0", sha256: release.sha256 }));
      // The other platform's names don't count.
      fs.writeFileSync(path.join(folder, platform === "win32" ? COMMAND : names.command + ".other"), "x");
      assert.equal(antigravity.resolve(), null, key);
      fs.writeFileSync(path.join(folder, names.command), "x");
      fs.writeFileSync(path.join(folder, names.harness), "x");
      const found = antigravity.resolve();
      assert.equal(found.command, path.join(folder, names.command), key);
      assert.equal(found.harness, path.join(folder, names.harness), key);
      assert.deepEqual(found.args, platform === "linux" ? ["--uid="] : [], key);
      // The override names the agent file; a harness beside it is found by the platform's name.
      const override = createAntigravity({ dataDir, platform, arch, env: { [OVERRIDE_ENV]: path.join(folder, names.command) } }).resolve();
      assert.equal(override.harness, path.join(folder, names.harness), key);
      assert.equal(createAntigravity({ dataDir, platform, arch, env: { [OVERRIDE_ENV]: path.join(folder, "agy_acp_server.bin") } }).resolve(), null, key);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test("the spawn passes --uid= on Linux only, and finds the harness by the platform's name", () => {
  assert.deepEqual(antigravitySpawn({ command: "/a/agy_acp_server.par", platform: "linux", env: {} }).args, ["--uid="]);
  assert.deepEqual(antigravitySpawn({ command: "/a/agy_acp_server.par", platform: "darwin", env: {} }).args, []);
  assert.deepEqual(antigravitySpawn({ command: "C:\\a\\agy_acp_server.exe", platform: "win32", env: {} }).args, []);
  // An explicit list (the resolved install's) wins.
  assert.deepEqual(antigravitySpawn({ command: "/a/agy_acp_server.par", args: [], platform: "linux", env: {} }).args, []);
  const harnessOf = (platform, command) => antigravityEnv({ env: {}, command, platform }).ANTIGRAVITY_HARNESS_PATH;
  assert.equal(harnessOf("linux", "/a/agy_acp_server.par"), path.join("/a", "localharness_external"));
  assert.equal(harnessOf("win32", path.join("/a", "agy_acp_server.exe")), path.join("/a", "localharness_external.exe"));
});

test("archive commands: unzip on macOS and Linux, System32 tar on Windows", () => {
  const unix = archiveCommands("darwin", "/t/a.zip", "/t/out", { exists: () => true });
  assert.equal(unix.file, "/usr/bin/unzip");
  assert.deepEqual(unix.list, ["-Z1", "/t/a.zip"]);
  assert.deepEqual(unix.extract, ["-q", "-o", "/t/a.zip", "-d", "/t/out"]);
  assert.equal(archiveCommands("linux", "/t/a.zip", "/t/out", { exists: (file) => file === "/bin/unzip" }).file, "/bin/unzip");
  assert.equal(archiveCommands("linux", "/t/a.zip", "/t/out", { exists: () => false }).file, "/usr/bin/unzip");
  const win = archiveCommands("win32", "C:\\d\\a.zip", "C:\\d\\out", { env: { SystemRoot: "D:\\Win" } });
  assert.equal(win.file, "D:\\Win\\System32\\tar.exe");
  assert.deepEqual(win.list, ["-tf", "C:\\d\\a.zip"]);
  assert.deepEqual(win.extract, ["-xf", "C:\\d\\a.zip", "-C", "C:\\d\\out"]);
  assert.equal(archiveCommands("win32", "a", "b", { env: {} }).file, "C:\\Windows\\System32\\tar.exe");
});

// macOS's /usr/bin/tar is the same bsdtar that Windows ships as tar.exe, so it proves the Windows arguments.
const bsdtar = process.platform === "darwin" ? false : "needs bsdtar (macOS tar), the same tool as Windows' tar.exe";

test("a Windows install lists and unpacks the .exe archive with tar and validates it", { skip: skip || bsdtar }, async (t) => {
  const names = memberNames("win32");
  const { make, release, dataDir } = await fixture(t, { files: { [names.command]: agentScript(), [names.harness]: "harness\n" } });
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push(file);
    return execFile(file.endsWith("tar.exe") ? "/usr/bin/tar" : file, args, options, callback);
  };
  const validated = [];
  const antigravity = make({
    platform: "win32",
    arch: "x64",
    releases: { "win32-x64": release },
    env: { SystemRoot: "C:\\Windows" },
    execFileImpl,
    validate: async (options) => validated.push(options),
  });
  assert.deepEqual(await antigravity.install(), { version: "9.9.9", changed: true });
  assert.ok(calls.length === 2 && calls.every((file) => file === "C:\\Windows\\System32\\tar.exe"), calls.join());
  assert.equal(validated.length, 1);
  assert.equal(path.basename(validated[0].command), names.command);
  assert.equal(path.basename(validated[0].harness), names.harness);
  const found = antigravity.resolve();
  assert.equal(found.command, path.join(dataDir, "tools", "antigravity", "win32-x64", "versions", release.sha256, names.command));
  assert.equal(fs.readFileSync(found.harness, "utf8"), "harness\n");
  // An archive with the macOS names instead is refused on Windows.
  const wrong = await fixture(t);
  await assert.rejects(
    wrong
      .make({
        platform: "win32",
        arch: "x64",
        releases: { "win32-x64": { ...wrong.release, files: release.files } },
        env: { SystemRoot: "C:\\Windows" },
        execFileImpl,
        validate: async () => {},
      })
      .install(),
    /unexpected contents/,
  );
});

test("a Linux install validates with --uid=", { skip }, async (t) => {
  const { make, release } = await fixture(t);
  const validated = [];
  const antigravity = make({
    platform: "linux",
    arch: "x64",
    releases: { "linux-x64": { ...release, args: RELEASES["linux-x64"].args } },
    validate: async (options) => validated.push(options),
  });
  await antigravity.install();
  assert.deepEqual(validated[0].args, ["--uid="]);
  assert.deepEqual(antigravity.resolve().args, ["--uid="]);
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

test("on Windows the agent's temporary directory is also TEMP and TMP", () => {
  const { antigravitySpawn } = require("./antigravity-acp.cjs");
  const windows = antigravitySpawn({ command: "C:\\agy\\agy_acp_server.exe", env: { GEMINI_HOME: "C:\\p" }, tmpdir: "C:\\t", platform: "win32" }).env;
  assert.equal(windows.TMPDIR, "C:\\t");
  assert.equal(windows.TEMP, "C:\\t");
  assert.equal(windows.TMP, "C:\\t");
  const mac = antigravitySpawn({ command: "/agy/agy_acp_server.par", env: { GEMINI_HOME: "/p" }, tmpdir: "/t", platform: "darwin" }).env;
  assert.equal(mac.TMPDIR, "/t");
  assert.equal(mac.TEMP, undefined);
});
