// A task-owned host in the default Windows profile, to exercise the NSIS hook.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { connect } = require("@milagre/daemon/client");

async function main() {
  assert.equal(process.platform, "win32");
  const [phase, executable] = process.argv.slice(2);
  const profile = path.join(process.env.APPDATA, "Milagre");
  const record = path.join(process.env.RUNNER_TEMP, "milagre-installer-host.json");
  if (phase === "start") {
    const project = path.join(process.env.RUNNER_TEMP, "Milagre Installer Project");
    await fs.mkdir(project, { recursive: true });
    execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
    const cli = path.join(path.dirname(executable), "resources", "app.asar", "node_modules", "@milagre", "daemon", "src", "cli.cjs");
    const child = spawn(executable, [cli, "serve", "--data-dir", profile, "--cwd", project], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      detached: true,
      stdio: "ignore",
      cwd: project,
    });
    child.unref();
    let launchError;
    child.on("error", (error) => {
      launchError = error;
    });
    let client;
    const deadline = Date.now() + 30000;
    while (!client && Date.now() < deadline) {
      if (launchError) throw launchError;
      try {
        client = await connect({ dataDir: profile, timeoutMs: 3000 });
      } catch (error) {
        if (!["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(error.code)) throw error;
        await delay(100);
      }
    }
    assert.ok(client, "installed host starts in the default profile");
    try {
      assert.equal((await client.call("daemon:status")).pid, child.pid);
      const opened = await client.call("project:current");
      const chat = Object.values(opened.state.sessions)[0];
      await client.call("chat:patch", [project, chat.id, { title: "Saved before installer shutdown" }]);
      // Deliberately leave the daemon alive, as a normal desktop quit does.
      await fs.writeFile(record, JSON.stringify({ pid: child.pid, project, chatId: chat.id }));
    } finally {
      client.close();
    }
    console.log("PASS: installed background host remains running before the installer change");
  } else if (phase === "stopped") {
    const { pid, project, chatId } = JSON.parse(await fs.readFile(record, "utf8"));
    assert.throws(() => process.kill(pid, 0), "NSIS must stop the previous installed host");
    await assert.rejects(fs.stat(path.join(profile, "runtime.lock")), { code: "ENOENT" });
    const state = await require("@milagre/core/project-store").readProjectState(project);
    assert.equal(state.sessions[chatId].title, "Saved before installer shutdown", "the host saved accepted Chat changes before replacement");
    console.log("PASS: NSIS gracefully stops the installed host and releases ownership with its saved Chat intact");
  } else throw new Error("Choose start or stopped");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
