const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { inputSchema, runTool } = require("./linked-tools.cjs");

const MAX_BODY = 1024 * 1024;

// Codex reaches Milagre's linked tools as a streamable-HTTP MCP server named in each thread's config
// (verified with codex-cli 0.160: the per-thread `config.mcp_servers` entry is started, listed and called,
// and its calls need no Codex approval). It listens on loopback only; each Chat has its own unguessable
// path, which is all that names the Chat. Requests are answered with plain JSON, never a stream.
function createLinkedMcpServer({ toolsFor }) {
  const tokens = new Map();
  const chats = new Map();
  let listening = null;

  const server = http.createServer((request, response) => {
    const chatId = tokens.get(/^\/mcp\/([a-f0-9]+)$/.exec(request.url ?? "")?.[1]);
    if (!chatId) { response.writeHead(404).end(); return; }
    if (request.method !== "POST") { response.writeHead(405, { allow: "POST" }).end(); return; }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) request.destroy();
    });
    request.on("end", () => {
      let message;
      try { message = JSON.parse(body); } catch { reply(response, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
      const messages = Array.isArray(message) ? message : [message];
      Promise.all(messages.map(item => answer(chatId, item))).then((answers) => {
        const replies = answers.filter(Boolean);
        if (!replies.length) response.writeHead(202).end();
        else reply(response, Array.isArray(message) ? replies : replies[0]);
      }, (error) => reply(response, { jsonrpc: "2.0", id: null, error: { code: -32603, message: error.message } }));
    });
  });

  function reply(response, payload) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
  }

  async function answer(chatId, message) {
    if (message?.id === undefined || message.id === null) return null;
    const ok = (result) => ({ jsonrpc: "2.0", id: message.id, result });
    const tools = toolsFor(chatId);
    switch (message.method) {
      case "initialize":
        return ok({ protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "milagre", version: "1" } });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: inputSchema(tool), annotations: { readOnlyHint: tool.readOnly } })) });
      case "tools/call": {
        const tool = tools.find(item => item.name === message.params?.name);
        if (!tool) return ok({ content: [{ type: "text", text: `Unknown tool: ${message.params?.name}` }], isError: true });
        const { text, isError } = await runTool(tool, message.params?.arguments);
        return ok({ content: [{ type: "text", text }], isError });
      }
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
    }
  }

  return {
    /** The Chat's MCP endpoint, listening once this resolves. One per Chat for the life of the server. */
    async url(chatId) {
      // A failed listen is tried again on the next call.
      listening ??= new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      }).catch((error) => { listening = null; throw error; });
      const port = await listening;
      if (!chats.has(chatId)) {
        const token = randomBytes(24).toString("hex");
        tokens.set(token, chatId);
        chats.set(chatId, token);
      }
      return `http://127.0.0.1:${port}/mcp/${chats.get(chatId)}`;
    },
    close() {
      if (!listening) return Promise.resolve();
      server.closeAllConnections();
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

module.exports = { createLinkedMcpServer };
