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
  assert.deepEqual(second, { id: first.id, title: "Login, darker", version: 2, versions: 2 });
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
  });
});

test("ids can't leave the Chat's folder", async (t) => {
  const { api } = await fixture(t);
  await assert.rejects(api.get({ chatId: CHAT, id: "../secrets" }), /lowercase letters/);
  await assert.rejects(api.show({ chatId: CHAT, id: "../x", title: "x", html: "x" }), /lowercase letters/);
});
