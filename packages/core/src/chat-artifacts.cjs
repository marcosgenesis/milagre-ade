const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { z } = require("zod");

// Design artifacts: HTML an agent shows in its Chat. Each artifact keeps its versions, so a reply's card shows the
// design as it was then while the docked viewer follows the latest. They live in the host profile, one file each.
const MAX_HTML = 1_000_000;
const MAX_VERSIONS = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// The screen a design is laid out on when the agent names none: a laptop window.
const VIEWPORT = { width: 1280, height: 800 };
// The comments the user sent on a Chat's designs, one file beside the designs; no .json extension, so the design list
// never reads it as a design. Each: { id, design: { id, version, title }, x?, y?, text, createdAt, resolved? }.
const COMMENTS = "comments";
const MAX_COMMENTS = 2000;
const COMMENT_ID = /^[a-f0-9]{8}$/;
const size = (value, fallback) => (Number.isInteger(value) && value >= 240 && value <= 3840 ? value : fallback);

function fileOf(folder, id) {
  if (typeof id !== "string" || !ID.test(id)) throw Error("Artifact ids are lowercase letters, digits and dashes.");
  return path.join(folder, `${id}.json`);
}
const summary = (artifact, entry) => ({
  id: artifact.id,
  title: entry.title,
  version: entry.version,
  versions: artifact.versions.length,
  width: entry.width ?? VIEWPORT.width,
  height: entry.height ?? VIEWPORT.height,
});

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
        const entry = {
          version: (previous.at(-1)?.version ?? 0) + 1,
          title: title.trim().slice(0, 120),
          html,
          // A revision keeps the screen size it doesn't name.
          width: size(request.width, previous.at(-1)?.width ?? VIEWPORT.width),
          height: size(request.height, previous.at(-1)?.height ?? VIEWPORT.height),
          createdAt: Date.now(),
        };
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
      // In the order the agent first showed them, as the canvas lays them out.
      return artifacts
        .filter(Boolean)
        .sort((a, b) => a.versions[0].createdAt - b.versions[0].createdAt)
        .map((artifact) => summary(artifact, artifact.versions.at(-1)));
    },
    /** Records the comments the user is sending, and returns them with their ids for the message to name. */
    addComments: (request) =>
      serial(async () => {
        const folder = await chat(request?.chatId);
        const incoming = Array.isArray(request?.comments) ? request.comments : [];
        if (!incoming.length || incoming.length > 50) throw Error("Send between 1 and 50 comments at once.");
        const added = incoming.map((comment) => {
          const design = comment?.design;
          if (!design || typeof design.id !== "string" || !ID.test(design.id) || !Number.isInteger(design.version)) throw Error("A comment names its design.");
          const text = typeof comment.text === "string" ? comment.text.trim().slice(0, 4000) : "";
          if (!text) throw Error("A comment needs its text.");
          const at = (value) => (typeof value === "number" && value >= 0 && value <= 1 ? value : undefined);
          return {
            id: randomUUID().replace(/-/g, "").slice(0, 8),
            design: { id: design.id, version: design.version, title: String(design.title ?? design.id).slice(0, 120) },
            ...(at(comment.x) === undefined || at(comment.y) === undefined ? {} : { x: at(comment.x), y: at(comment.y) }),
            text,
            createdAt: Date.now(),
          };
        });
        await writeComments(folder, [...(await readComments(folder)), ...added].slice(-MAX_COMMENTS));
        return added;
      }),
    async comments(request) {
      return readComments(await chat(request?.chatId));
    },
    /** Marks a comment resolved, with the agent's note on what it did about it. */
    resolveComment: (request) =>
      serial(async () => {
        const folder = await chat(request?.chatId);
        const note = typeof request?.note === "string" ? request.note.trim().slice(0, 2000) : "";
        if (!note) throw Error("Say how the comment was resolved.");
        const all = await readComments(folder);
        const comment = all.find((item) => item.id === request?.id);
        if (!comment) throw Error(`No comment ${request?.id} in this Chat. List them with artifact_comments.`);
        comment.resolved = { note, at: Date.now() };
        await writeComments(folder, all);
        return comment;
      }),
    close: () => queue,
  };
  async function readComments(folder) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(folder, COMMENTS), "utf8"));
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async function writeComments(folder, comments) {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, COMMENTS);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(comments), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

function artifactToolDefinitions(chatId, api) {
  return [
    {
      name: "artifact_show",
      description:
        "Show a design to the user in this Chat: a self-contained HTML document (inline CSS and JS; https images, fonts and CDN scripts load, network requests do not). The Chat shows it as a card the user can open beside the chat, on desktop and phone. width and height are the screen it is laid out on, 1280 by 800 unless you say (390 by 844 for a phone screen); the user sees every design of the Chat side by side on a canvas. An id is optional (lowercase letters, digits and dashes); a new id creates a design, and showing an existing id again adds a version the user sees in place of the old one, which stays available.",
      input: {
        title: z.string().min(1).max(120),
        html: z.string().min(1).max(MAX_HTML),
        width: z.number().int().min(240).max(3840).optional(),
        height: z.number().int().min(240).max(3840).optional(),
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
    {
      name: "artifact_comments",
      description:
        "List the comments the user left on this Chat's designs, the open ones unless you ask for all. Each has an id, its design and version, where on it the user pinned it (x and y as fractions of the design's screen) and its text.",
      input: { all: z.boolean().optional() },
      readOnly: true,
      run: async ({ all }) => JSON.stringify((await api.comments({ chatId })).filter((comment) => all || !comment.resolved)),
    },
    {
      name: "artifact_resolve_comment",
      description:
        "Mark one of the user's comments on a design resolved once you have addressed it (usually after showing a revised version), with a short note on what you changed. The user sees the comment resolved, with your note, in the chat and on the canvas. The comment's id is in the user's message, or from artifact_comments.",
      input: { id: z.string().regex(COMMENT_ID), note: z.string().min(1).max(2000) },
      readOnly: false,
      run: async (args) => JSON.stringify(await api.resolveComment({ chatId, ...args })),
    },
  ];
}

module.exports = { createChatArtifacts, artifactToolDefinitions };
