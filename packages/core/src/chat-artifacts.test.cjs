const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createChatArtifacts, artifactToolDefinitions } = require("./chat-artifacts.cjs");

const CHAT = "/repo#3";
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat-artifacts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const api = createChatArtifacts({
    directory,
    validateChat: async (chatId) => {
      if (chatId !== CHAT && chatId !== "/repo#4") throw Error("Open an existing Chat before showing a design.");
    },
  });
  const tools = Object.fromEntries(artifactToolDefinitions(CHAT, api).map((tool) => [tool.name, tool]));
  return { api, tools, directory };
}

test("a design keeps each version the agent showed", async (t) => {
  const { api, tools } = await fixture(t);
  const first = JSON.parse(await tools.artifact_show.run({ title: "Login", html: "<p>one</p>" }));
  assert.equal(first.version, 1);
  assert.match(first.id, /^[a-z0-9-]+$/);
  const second = JSON.parse(await tools.artifact_show.run({ id: first.id, title: "Login, darker", html: "<p>two</p>" }));
  assert.deepEqual(second, { id: first.id, title: "Login, darker", version: 2, versions: 2, width: 1280, height: 800 });
  assert.equal((await api.get({ chatId: CHAT, id: first.id })).html, "<p>two</p>");
  const old = await api.get({ chatId: CHAT, id: first.id, version: 1 });
  assert.deepEqual([old.html, old.title, old.latest], ["<p>one</p>", "Login", 2]);
  assert.deepEqual(JSON.parse(await tools.artifact_read.run({ id: first.id, version: 1 })).html, "<p>one</p>");
  assert.deepEqual(
    (await api.list({ chatId: CHAT })).map((item) => item.version),
    [2],
  );
});

test("a design belongs to its Chat", async (t) => {
  const { api, tools } = await fixture(t);
  const { id } = JSON.parse(await tools.artifact_show.run({ title: "Card", html: "<p>x</p>" }));
  await assert.rejects(api.get({ chatId: "/repo#4", id }), /no longer available/);
  await assert.rejects(api.get({ chatId: "/other#1", id }), /existing Chat/);
  assert.deepEqual(JSON.parse(await tools.artifact_show.run({ id: "home-screen", title: "Home", html: "<p>x</p>" })), {
    id: "home-screen",
    title: "Home",
    version: 1,
    versions: 1,
    width: 1280,
    height: 800,
  });
});

test("ids can't leave the Chat's folder", async (t) => {
  const { api } = await fixture(t);
  await assert.rejects(api.get({ chatId: CHAT, id: "../secrets" }), /lowercase letters/);
  await assert.rejects(api.show({ chatId: CHAT, id: "../x", title: "x", html: "x" }), /lowercase letters/);
});

test("a design keeps the screen size it was shown at until a revision names another", async (t) => {
  const { api, tools } = await fixture(t);
  await tools.artifact_show.run({ id: "phone", title: "Phone", html: "<p>1</p>", width: 390, height: 844 });
  await tools.artifact_show.run({ id: "phone", title: "Phone", html: "<p>2</p>" });
  await tools.artifact_show.run({ id: "wide", title: "Wide", html: "<p>w</p>" });
  assert.deepEqual(
    (await api.list({ chatId: CHAT })).map(({ id, version, width, height }) => [id, version, width, height]),
    [
      ["phone", 2, 390, 844],
      ["wide", 1, 1280, 800],
    ],
  );
});

test("the agent resolves the user's comments with a note, and lists the open ones", async (t) => {
  const { api, tools } = await fixture(t);
  JSON.parse(await tools.artifact_show.run({ id: "home", title: "Home", html: "<p>1</p>" }));
  const design = { id: "home", version: 1, title: "Home" };
  const added = await api.addComments({
    chatId: CHAT,
    comments: [
      { design, x: 0.5, y: 0.2, text: " Bigger title " },
      { design, text: "Too busy" },
    ],
  });
  assert.equal(added.length, 2);
  assert.match(added[0].id, /^[a-f0-9]{8}$/);
  assert.deepEqual([added[0].text, added[0].x, added[1].x], ["Bigger title", 0.5, undefined]);
  const resolved = JSON.parse(await tools.artifact_resolve_comment.run({ id: added[0].id, note: "Title is 32px now" }));
  assert.equal(resolved.resolved.note, "Title is 32px now");
  assert.deepEqual(
    JSON.parse(await tools.artifact_comments.run({})).map((comment) => comment.text),
    ["Too busy"],
  );
  assert.equal(JSON.parse(await tools.artifact_comments.run({ all: true })).length, 2);
  await assert.rejects(tools.artifact_resolve_comment.run({ id: "ffffffff", note: "x" }), /No comment ffffffff/);
  // The comments file is no design.
  assert.deepEqual(
    (await api.list({ chatId: CHAT })).map((item) => item.id),
    ["home"],
  );
  await assert.rejects(api.comments({ chatId: "/other#1" }), /existing Chat/);
});

test("comments the app names are kept by that id, once", async (t) => {
  const { api } = await fixture(t);
  const design = { id: "home", version: 1, title: "Home" };
  const comment = { design, text: "Bigger", id: "0a1b2c3d" };
  assert.equal((await api.addComments({ chatId: CHAT, comments: [comment] }))[0].id, "0a1b2c3d");
  await api.addComments({ chatId: CHAT, comments: [comment] });
  assert.deepEqual(
    (await api.comments({ chatId: CHAT })).map((item) => item.id),
    ["0a1b2c3d"],
    "a retried send records nothing twice",
  );
});

const chatFolder = async (directory) => path.join(directory, (await fs.readdir(directory))[0]);

test("a design is a folder: metadata without HTML, and one HTML file per version", async (t) => {
  const { api, directory } = await fixture(t);
  const { id } = await api.show({ chatId: CHAT, title: "Login", html: "<p>one</p>" });
  await api.show({ chatId: CHAT, id, title: "Login", html: "<p>two</p>" });
  const folder = path.join(await chatFolder(directory), id);
  assert.deepEqual((await fs.readdir(folder)).sort(), ["meta.json", "v1.html", "v2.html"]);
  const meta = JSON.parse(await fs.readFile(path.join(folder, "meta.json"), "utf8"));
  assert.equal(meta.id, id);
  for (const entry of meta.versions) assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "height", "title", "version", "width"]);
  assert.equal(await fs.readFile(path.join(folder, "v2.html"), "utf8"), "<p>two</p>");
  // The list needs only the metadata: with every HTML file gone it still lists the design.
  await fs.rm(path.join(folder, "v1.html"));
  await fs.rm(path.join(folder, "v2.html"));
  assert.deepEqual(
    (await api.list({ chatId: CHAT })).map((item) => [item.id, item.version]),
    [[id, 2]],
  );
});

test("trimming old versions deletes their HTML", async (t) => {
  const { api, directory } = await fixture(t);
  const { id } = await api.show({ chatId: CHAT, title: "Loop", html: "<p>1</p>" });
  for (let n = 2; n <= 52; n++) await api.show({ chatId: CHAT, id, title: "Loop", html: `<p>${n}</p>` });
  const files = await fs.readdir(path.join(await chatFolder(directory), id));
  assert.equal(files.length, 51);
  assert.ok(!files.includes("v1.html") && !files.includes("v2.html") && files.includes("v3.html") && files.includes("v52.html"));
  assert.equal((await api.list({ chatId: CHAT }))[0].versions, 50);
});

test("a design saved in the old single-file format is converted on first access", async (t) => {
  const { api, directory } = await fixture(t);
  const { id } = await api.show({ chatId: CHAT, title: "Seed", html: "<p>seed</p>" });
  const folder = await chatFolder(directory);
  await fs.rm(path.join(folder, id), { recursive: true });
  const versions = [
    { version: 1, title: "Old", html: "<p>a</p>", width: 390, height: 844, createdAt: 1 },
    { version: 2, title: "Older, newer", html: "<p>b</p>", width: 390, height: 844, createdAt: 2 },
  ];
  await fs.writeFile(path.join(folder, "legacy.json"), JSON.stringify({ id: "legacy", versions }));
  assert.deepEqual(
    (await api.list({ chatId: CHAT })).map((item) => [item.id, item.title, item.versions, item.width]),
    [["legacy", "Older, newer", 2, 390]],
  );
  assert.equal((await api.get({ chatId: CHAT, id: "legacy", version: 1 })).html, "<p>a</p>");
  assert.deepEqual((await fs.readdir(folder)).sort(), ["legacy"]);
  assert.equal((await api.show({ chatId: CHAT, id: "legacy", title: "Third", html: "<p>c</p>" })).version, 3);
});

test("removing a Chat deletes its designs and comments, and only its own", async (t) => {
  const { api, directory } = await fixture(t);
  await api.show({ chatId: CHAT, title: "Mine", html: "<p>x</p>" });
  await api.show({ chatId: "/repo#4", title: "Other", html: "<p>y</p>" });
  await api.addComments({ chatId: CHAT, comments: [{ design: { id: "a", version: 1 }, text: "hi" }] });
  await api.removeChat(CHAT);
  assert.equal((await fs.readdir(directory)).length, 1);
  assert.deepEqual(await api.list({ chatId: CHAT }), []);
  assert.equal((await api.list({ chatId: "/repo#4" })).length, 1);
  await api.removeChat(CHAT);
});
