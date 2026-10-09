// Real mobile UI and host advisor lifecycle, with scripted providers and a temporary Project.
// Run with node scripts/mobile-advisors-fixture.cjs; type finish to complete the active review.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createInterface } = require("node:readline");
const { startDaemon } = require("../apps/daemon/src/server.cjs");
const { startMobileBridge } = require("../apps/daemon/src/mobile-bridge.cjs");
const { connect } = require("../apps/daemon/src/client.cjs");
const { demoRuntimeOptions } = require("../apps/daemon/src/demo-agent.cjs");
const { runTool } = require("../packages/core/src/linked-tools.cjs");
const { startMetro } = require("./start-mobile.cjs");
const { waitUntil } = require("../packages/core/src/agents/test-helpers.cjs");

async function startFixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-mobile-advisors-")));
  const project = path.join(root, "Advisor preview");
  await fs.mkdir(project);
  execFileSync("git", ["init", "-qb", "main", project]);
  const dataDir = path.join(root, "profile");
  const sessions = [];
  const runtimeOptions = {
    ...demoRuntimeOptions({ cwd: project, worktreeRoot: path.join(root, "worktrees") }),
    agentCliStatus: async () => ({ codex: { state: "ready" }, claude: { state: "ready" } }),
    agentModels: async () =>
      Object.fromEntries(["claude", "codex"].map((provider) => [provider, [{ id: "fixture", name: `${provider} fixture`, efforts: [], recommended: true }]])),
    createSession(provider, options) {
      const session = {
        provider,
        options,
        turnActive: false,
        async startTurn(request) {
          this.turnActive = true;
          this.request = request;
          options.emit({ type: "turn-started", turnId: randomBytes(8).toString("hex") });
          if (options.analysisOnly) {
            options.emit({
              type: "text-delta",
              text: "I checked the file access boundary.\n\nThe advisor can read the owned Project. Stop cancels this review; Retry keeps the same advisor.\n\n",
            });
            if (/complete/i.test(request.prompt)) setTimeout(() => session.finish(), 150);
            else if (/fail/i.test(request.prompt)) setTimeout(() => session.finish(true), 150);
          } else if (request.prompt?.startsWith("Advisor result from ")) {
            options.emit({ type: "text-delta", text: "The advisor result is saved. Inspect it in Subagents." });
            this.turnActive = false;
            options.emit({ type: "turn-completed" });
          }
          return { turnId: "fixture-turn" };
        },
        finish(failed = false) {
          this.turnActive = false;
          options.emit({
            type: "text-delta",
            text: failed ? "The scripted provider failed. Retry is available." : "The review is complete. Keep reads inside the owned Project.",
          });
          options.emit({ type: failed ? "turn-failed" : "turn-completed", message: failed ? "Scripted failure" : undefined });
        },
        async interrupt() {
          this.turnActive = false;
          options.emit({ type: "turn-cancelled" });
        },
        async close() {
          this.turnActive = false;
        },
      };
      sessions.push(session);
      return session;
    },
  };
  const daemon = await startDaemon({ dataDir, runtimeOptions });
  const client = await connect({ dataDir });
  const opened = await client.call("project:open", [project]);
  const chat = Object.values(opened.state.sessions)[0];
  const chatId = `${project}#${chat.id}`;
  await client.call("chat:patch", [project, chat.id, { title: "Advisor controls" }]);
  await client.call("chat:send", [{ projectPath: project, sessionId: chat.id, body: "Review the advisor controls.", provider: "claude", model: "fixture" }]);
  await waitUntil(() => sessions[0]?.request);
  const tool = sessions[0].options.linked.tools.find((t) => t.name === "create_advisor");
  async function create(title, prompt) {
    const result = await runTool(tool, { title, prompt });
    if (result.isError) throw new Error(result.content[0].text);
    await waitUntil(() => sessions.at(-1)?.options.analysisOnly && sessions.at(-1)?.request);
    return sessions.at(-1);
  }
  const completed = await create("Completed review", "Complete the review");
  await waitUntil(() => !completed.turnActive);
  const failed = await create("Failed review", "Fail the review");
  await waitUntil(() => !failed.turnActive);
  await create("Interrupted review", "Wait for instructions");
  const current = await client.call("project:open", [project]);
  const interrupted = current.state.sessions[chat.id].subagents.find((a) => a.title === "Interrupted review");
  await client.call("advisor:stop", [chatId, interrupted.id]);
  await create("Security review", "Wait for instructions");
  const token = randomBytes(32).toString("hex");
  const bridge = await startMobileBridge({ dataDir, port: 8788, token });
  const metro = startMetro({ ...process.env, CI: "1", EXPO_PUBLIC_DAEMON_URL: bridge.url, EXPO_PUBLIC_DAEMON_TOKEN: token, EXPO_PUBLIC_DEMO: "1" }, [
    "--port",
    "8891",
  ]);
  console.log("Advisor fixture ready. Metro: 8891. Type finish to complete the active review.");
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (line.trim() === "finish") sessions.filter((s) => s.options.analysisOnly && s.turnActive).forEach((s) => s.finish());
  });
  const close = async () => {
    input.close();
    metro.kill("SIGTERM");
    await bridge.close();
    client.close();
    await daemon.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  metro.once("exit", () => void close());
  return { root, project, close };
}
if (require.main === module)
  startFixture().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { startFixture };
