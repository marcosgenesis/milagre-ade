const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { z } = require("zod");

// Design artifacts: HTML an agent shows in its Chat. Each artifact keeps its versions, so a reply's card shows the
// design as it was then while the docked viewer follows the latest. They live in the host profile, one file each.
const MAX_HTML = 1_000_000;
const MAX_VERSIONS = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fileOf(folder, id) {
  if (typeof id !== "string" || !ID.test(id)) throw Error("Artifact ids are lowercase letters, digits and dashes.");
  return path.join(folder, `${id}.json`);
}
const summary = (artifact, entry) => ({ id: artifact.id, title: entry.title, version: entry.version, versions: artifact.versions.length });

function createChatArtifacts({ directory, validateChat }) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const chatDirectory = (chatId) => path.join(directory, createHash("sha256").update(chatId).digest("hex").slice(0, 32));
  async function chat(chatId) {
    if (typeof chatId !== "string" || !chatId || chatId.length > 8192) throw Error("An existing Chat is required.");
    await validateChat(chatId);
    return chatDirectory(chatId);
  }
  async function load(folder, id) {
    try {
      return JSON.parse(await fs.readFile(fileOf(folder, id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async function store(folder, artifact) {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const file = fileOf(folder, artifact.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(artifact), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  return {
    show: (request) =>
      serial(async () => {
        const folder = await chat(request?.chatId);
        const { title, html } = request ?? {};
        if (typeof title !== "string" || !title.trim()) throw Error("An artifact needs a title.");
        if (typeof html !== "string" || !html.trim()) throw Error("An artifact needs its HTML.");
        if (html.length > MAX_HTML) throw Error(`Artifact HTML is limited to ${MAX_HTML} characters.`);
        const id = request.id ?? randomUUID().slice(0, 8);
        const existing = request.id ? await load(folder, id) : null;
        const previous = existing?.versions ?? [];
        const entry = { version: (previous.at(-1)?.version ?? 0) + 1, title: title.trim().slice(0, 120), html, createdAt: Date.now() };
        const artifact = { id, versions: [...previous, entry].slice(-MAX_VERSIONS) };
        await store(folder, artifact);
        return summary(artifact, entry);
      }),
    async get(request) {
      const folder = await chat(request?.chatId);
      const artifact = await load(folder, request?.id);
      if (!artifact) throw Error("This design is no longer available.");
      const entry = request.version === undefined ? artifact.versions.at(-1) : artifact.versions.find((item) => item.version === request.version);
      if (!entry) throw Error(`Version ${request.version} of this design is no longer kept.`);
      return { ...summary(artifact, entry), latest: artifact.versions.at(-1).version, html: entry.html };
    },
    async list(request) {
      const folder = await chat(request?.chatId);
      const names = await fs.readdir(folder).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
      const artifacts = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => load(folder, name.slice(0, -5))));
      return artifacts.filter(Boolean).map((artifact) => summary(artifact, artifact.versions.at(-1)));
    },
    close: () => queue,
  };
}

function artifactToolDefinitions(chatId, api) {
  return [
    {
      name: "artifact_show",
      description:
        "Show a design to the user in this Chat: a self-contained HTML document (inline CSS and JS; https images, fonts and CDN scripts load, network requests do not). The Chat shows it as a card the user can open beside the chat, on desktop and phone. An id is optional (lowercase letters, digits and dashes); a new id creates a design, and showing an existing id again adds a version the user sees in place of the old one, which stays available.",
      input: {
        title: z.string().min(1).max(120),
        html: z.string().min(1).max(MAX_HTML),
        id: z.string().regex(ID).optional(),
      },
      readOnly: false,
      run: async (args) => JSON.stringify(await api.show({ chatId, ...args })),
    },
    {
      name: "artifact_read",
      description: "Read the HTML of a design shown in this Chat, its latest version unless you name one. Use it before revising a design you no longer have.",
      input: { id: z.string().regex(ID), version: z.number().int().positive().optional() },
      readOnly: true,
      run: async (args) => JSON.stringify(await api.get({ chatId, ...args })),
    },
  ];
}

module.exports = { createChatArtifacts, artifactToolDefinitions };
