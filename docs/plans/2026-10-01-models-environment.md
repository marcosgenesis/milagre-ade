# Models and Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milagre works when it's opened from Finder or the Dock. It finds `claude` and `codex`, and agents get the user's shell environment, so `node`, `git` and `gh` work in their commands. The model picker lists the models each CLI reports. A missing, outdated, logged-out or crashed CLI fails the turn with a short message that names the fix, and the next message recovers without a restart.

**Architecture:**

- **Login environment.** `electron/agents/environment.cjs` runs `$SHELL -i -l -c` once at startup, in the background.
  - It reads the environment printed between two random marks and fills in the variables the app lacks.
  - It merges `PATH`: the shell's folders, then the app's, then common install folders.
  - The first agent waits for it. Windows don't.
- **CLI check.** A new `electron/agents/cli.cjs` resolves each CLI on the merged `PATH` and runs `--version` once per app run. The minimums are Claude Code 2.1.286 and Codex 0.158.0.
  - A CLI that's missing, too old or doesn't start gives the message the turn fails with.
  - Such a CLI is checked again on the next message.
  - `agent:start-turn` rejects with that message, and the renderer already shows a rejected start as the turn's failure.
- **Not logged in.**
  - **Claude:** a turn Claude Code marks `authentication_failed` maps to the login message in `events.cjs`.
  - **Codex:** the provider calls `account/read` before its first thread. A failed turn with a 401 also maps to the login message.
- **Crashes.** Both providers word a dead process as "… stopped unexpectedly: <last line>. Send your message again to continue this chat." Resuming on the next message already works; the probes confirmed it.
- **Models.** A new `electron/agents/models.cjs` replaces `capabilities.cjs`. It asks Claude's `supportedModels()` and Codex's `model/list` once per run, and returns each model's id, name, description, recommendation and effort levels. `agent:models` replaces `agent:capabilities`.
  - The renderer merges the lists with the maintained `MODEL_CATALOG` (`app/src/lib/models.ts`).
  - The maintained list stands in while the lists load and for a missing CLI.
  - A model the agents don't offer gives way to its provider's recommended model.

**Tech Stack:** Electron main process in CommonJS (`.cjs`), `@anthropic-ai/claude-agent-sdk@0.3.286` with Claude Code 2.1.287, `codex app-server` (codex-cli 0.158.0), React 19 + TypeScript renderer, `node --test`.

**Spec:** `docs/specs/002-agent-sessions.md`, delivery step 4 ("Models and environment"). The spec was amended on this branch (commit `docs: bring models and environment into the agent sessions spec`). Read "Environment" and "Models" first, then "Session lifecycle" (Crashes), "Claude provider" (Version, Not logged in), "Codex provider" (Login, Protocol types) and "IPC contract".

## Probe findings this plan relies on

Probes ran against the real CLIs (Claude Code 2.1.287 with `claude-haiku-4-5`, codex-cli 0.158.0 with `gpt-6-sol`) and older downloaded builds. Scripts and logs are in the session scratchpad under `probe/env/`, `probe/versions/`, `probe/auth/`, `probe/crash/`, `probe/models/` and `probe/today/`. Victor's logins were never touched: logged-out runs used an empty `CLAUDE_CONFIG_DIR` or `CODEX_HOME`.

- **A real Finder launch.** A throwaway Electron app (own bundle id) was opened through Finder (`osascript … tell application "Finder" to open`).
  - Its environment had 14 keys and `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, with no `LANG`.
  - `/usr/bin/which` found neither `claude` nor `codex`, nor `node` or `gh`.
  - Codex by its full path failed with `env: node: No such file or directory`: it's an npm script under nvm (`~/.nvm/versions/node/v24.13.0/bin/codex`).
  - Claude Code by its full path ran (`~/.local/bin/claude`, a native binary).
- **What a Finder launch shows today.** Every message fails with "Agent error: Couldn't find the claude CLI. Install it and make sure it's on your PATH, then try again." (or the codex one).
- **The login shell.**
  - `zsh -i -l -c` took 630–830 ms on this Mac and printed the full `PATH`, with both CLIs' folders.
  - `zsh -l -c` took 9 ms and missed `~/.local/bin` and nvm, which `.zshrc` adds.
- **Shells.** zsh, bash and fish 4.9.3 all returned their rc file's `PATH` through `printf <mark>; /usr/bin/env -0; printf <mark>`, with throwaway homes:
  - a banner, a fake marker and text with no trailing newline were ignored;
  - an rc file that runs `read` got EOF from the ignored stdin and carried on;
  - `sleep 30` was killed at the timeout;
  - an rc file that `exec`s something else exited without the marks.
  - Caveat: fish came from an unpoured Homebrew bottle, whose share functions (`fish_add_path`) crash. Plain `set -gx PATH` worked under `-i -l -c`.
- **Versions.** `claude --version` prints `2.1.287 (Claude Code)` in 10–20 ms, and `codex --version` prints `codex-cli 0.158.0` in 40–80 ms.
  - SDK 0.3.286's package.json has `"claudeCodeVersion": "2.1.286"`, and the SDK checks no version at runtime.
  - Claude Code 2.0.77 rejects the SDK's flags: "Claude Code process exited with code 1" (its stderr: `unknown option '--effort'`).
  - 2.1.200 and 2.1.281 accepted every control call Milagre makes.
  - In codex-cli 0.130.0, 0.140.0, 0.150.0, 0.157.0, 0.158.0 and 0.160.0, every protocol name Milagre uses is present: `turn/steer`, `expectedTurnId`, `model/list`, `includeHidden`, `item/tool/requestUserInput`, `default_mode_request_user_input`, `serverRequest/resolved`, `account/read`.
- **Not logged in, Claude.**
  - `claude auth status` exits 1 with `"loggedIn": false`.
  - The first turn fails in 0.5 s. Its assistant message has `error: "authentication_failed"` and text "Not logged in · Please run /login", then comes a `result` with `subtype: "success"`, `is_error: true`.
  - Today the chat shows "Agent error: Not logged in · Please run /login". `/login` doesn't exist in Milagre.
- **Not logged in, Codex.**
  - `account/read` answers `{ account: null, requiresOpenaiAuth: true }` in 0.3 s. Logged in, it answers `{ account: { type: "chatgpt", … }, requiresOpenaiAuth: true }`.
  - `thread/start` and `turn/start` succeed anyway. Then come about 15 s of "Reconnecting… n/5", and `turn/completed` fails with `codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } }`.
  - Today the chat shows, after 14 s: "Agent error: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: …, request id: …".
- **Crashes.** These ran through Milagre's own SessionManager and providers, killing the agent with SIGKILL mid-reply.
  - Claude: "Agent error: Claude Code process terminated by signal SIGKILL".
  - Codex: "Agent error: Codex stopped: Codex exited with code null (SIGKILL)."
  - In both, the next message started a new process, resumed, and answered "PAPAYA", a word from before the crash.
- **Models.**
  - codex-cli 0.158.0 reports, logged in or not: `gpt-6-astra` (default), `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`. `codex-auto-review` and `gpt-reserve` come only with `includeHidden`.
  - 0.160.0's default is `gpt-6.1-sol`.
  - Milagre's current default model, `gpt-6.1-sol`, fails on 0.158.0: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." It reaches the chat as raw JSON. `gpt-4.1` fails the same way.
  - Claude Code 2.1.287's `supportedModels()` reports these aliases, then older ids:
    - `default` and `opus` resolve to `claude-opus-5-5`;
    - `fable` to `claude-fable-5-1`;
    - `sonnet` to `claude-sonnet-5-5`;
    - `haiku` to `claude-haiku-4-5-20251001`.
  - The current maintained list lacks Fable 5.1 and offers `claude-sonnet-4-5`, which Claude Code doesn't list.
  - The planned lookup returned both lists in 886 ms from a Finder-like environment.
- **Paseo** (ideas only).
  - It imports the whole login environment, VS Code's way: `$SHELL -i -l -c` printing `JSON.stringify(process.env)` between marks with `ELECTRON_RUN_AS_NODE`, a 30 s timeout, and a non-interactive retry.
  - It resolves binaries with `which -a` and probes each with `--version`.
  - It lists Codex models with `model/list`, but Claude models from a hardcoded manifest.
  - Borrowed: the marks, the whole environment, `-i -l -c`, and `model/list`. Not borrowed: `ELECTRON_RUN_AS_NODE` (`/usr/bin/env -0` needs no Node), the retry (the install folders cover it), the 30 s timeout, and the Claude manifest (`supportedModels()` is better).

## Global Constraints

- **Main process.** It stays CommonJS, and `@anthropic-ai/claude-agent-sdk` stays pinned to exactly `0.3.286`. No new dependencies.
- **Minimum versions.** Claude Code `2.1.286`, which must equal the SDK's `claudeCodeVersion` (a test enforces it), and codex-cli `0.158.0`. The version is the first `x.y.z` in `--version` output. An unreadable version is accepted.
- **Timeouts.** Login shell: 10,000 ms, then its process group gets SIGKILL. `--version`: 10,000 ms.
- **Login shell.**
  - Flags: exactly `-i -l -c`.
  - Shells: `zsh`, `bash`, `fish`, `sh`, `dash`, `ksh`, matched by basename. Any other shell is not started.
  - Shell: `$SHELL`, else `os.userInfo().shell`, else `/bin/zsh`.
  - Command line: `/usr/bin/printf '%s' '<mark>'; /usr/bin/env -0; /usr/bin/printf '%s' '<mark>'`, where the mark is `__MILAGRE_ENV_<16 hex chars>__`.
  - stdio: `["ignore", "pipe", "ignore"]`, detached.
  - No import on Windows.
- **Imported variables.** Everything the shell prints, except `PWD`, `OLDPWD`, `SHLVL` and `_`. A variable the app already has keeps its value, except `PATH`.
- **`PATH`.** The shell's folders, then the app's, then the install folders below. Each folder keeps its first position, and empty entries are dropped.
- **Install folders**, in order, only where they exist:
  1. `~/.local/bin`
  2. `~/.claude/local`
  3. `/opt/homebrew/bin`
  4. `/usr/local/bin`
  5. nvm's default node bin: `~/.nvm/alias/default` names a version prefix; the newest installed match, or the newest installed for an alias such as `lts/*`
  6. `~/.volta/bin`
  7. `~/.asdf/shims`
  8. `~/.local/share/mise/shims`
  9. `~/.npm-global/bin`
  10. `~/Library/pnpm`
  11. `~/.bun/bin`
- **Caching.** One CLI check and one model lookup per CLI per app run. A CLI with a problem, and a model lookup that fails or comes back empty, are tried again on the next call.
- **Copy**, exactly (`<…>` is filled in):
  - Missing:
    - "Milagre couldn't find Claude Code. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, then send your message again."
    - "Milagre couldn't find Codex. Install it with `npm install -g @openai/codex`, then send your message again."
  - Too old:
    - "Milagre needs Claude Code 2.1.286 or later, and you have <version>. Run `claude update` in a terminal, then send your message again."
    - "Milagre needs Codex 0.158.0 or later, and you have <version>. Run `codex update` in a terminal, then send your message again."
  - Doesn't start: "<Claude Code|Codex> (<path>) didn't start: <last line, no final period>. Check that it runs in a terminal, then send your message again." Without a last line: "… didn't start. Check …".
  - Not logged in:
    - "Claude Code isn't logged in. Run `claude auth login` in a terminal, then send your message again."
    - "Codex isn't logged in. Run `codex login` in a terminal, then send your message again."
  - Crashed: "<Claude Code|Codex> stopped unexpectedly: <last line, no final period>. Send your message again to continue this chat." Without a last line: "… stopped unexpectedly. Send …".
  - "Last line" means terminal colours removed, the last non-empty line, at most 300 characters.
- **Login detection.**
  - **Claude:** an assistant message with `error === "authentication_failed"` turns the next failed `result` into the login message.
  - **Codex:** `account/read { refreshToken: false }` returning `account: null` and `requiresOpenaiAuth: true` fails the turn and closes the session. Any error from `account/read` is ignored.
  - **Codex:** a failed turn whose `codexErrorInfo` is `"unauthorized"`, or an object with `httpStatusCode: 401`, shows the login message.
- **Models.**
  - IPC `agent:models` → `{ claude: ReportedModel[] | null, codex: ReportedModel[] | null }`, with `ReportedModel = { id, name, description, recommended, efforts, defaultEffort?, ultracode }`. Preload `getModels()`. `agent:capabilities` and `getModelCapabilities` are removed.
  - Claude: drop the `default` row, and use it only to mark the recommended model. Use `resolvedModel` for alias rows. Strip `[…]` and `-YYYYMMDD` suffixes, and keep only ids starting with `claude-`, once each.
  - Codex: call `model/list` without `includeHidden`, page by page, and drop any `hidden: true`.
  - Names and descriptions are the CLI's own, with a trailing period removed.
  - Order: each provider's recommended model first, then the CLI's order, Codex before Claude.
- **The maintained list** (`MODEL_CATALOG`), exactly as Task 6 writes it. It mirrors codex-cli 0.158.0 and Claude Code 2.1.287, recommended first.
- **Untouched:** `session-manager.cjs`, `agent-runs.ts`, `PromptBar.tsx` (unused) and `coordination.json`. Nothing is persisted.
- **Overlap with PR #30** (tool steps), expected to merge first. Every edit below is in a different hunk from PR #30's except one:
  - `events.cjs`: the new copy block replaces `missingCliMessage`, below PR #30's new `require`. The auth line sits under `const events = [];` in `mapClaudeMessage`, two lines below PR #30's comment change. The `result` branch and the Codex `failed` line change too, plus the exports line. PR #30 inserts blocks between the `stream_event` and `result` branches and in `mapCodexNotification`'s item handling.
  - `claude-provider.cjs`: the `events.cjs` import and one line in `handleEnd`. PR #30 adds two lines to `finishTurn`.
  - `codex-provider.cjs`: the import, one line in `start()`, a new `checkLogin` method above `requestThread`, and one line in `handleExit`. PR #30 changes the constructor's `state` and `finishTurn`.
  - `fixtures/fake-app-server.cjs`: two new `case`s after `case "initialized":`. PR #30 adds a header line and a `turn/start` block.
  - `App.tsx`: **one expected conflict.** The `runModelName=` line changes, and PR #30 adds two props right above it. Resolve by keeping PR #30's two props and this plan's `runModelName` line.
  - `ChatComposer.tsx`: a `models` prop next to `selectedModel` in the interface, the destructuring and the `PromptComposer` call. PR #30 adds props next to `streamingText`, three lines away.
  - `model.ts`: `MODEL_CATALOG` and two new types after it. PR #30 changes `ChatMessage`, `PermissionRequest` and `AgentEvent`.
  - `session-manager.cjs` and `agent-runs.ts`: not touched here.
- **Tests.**
  - Agent tests live next to the code (`electron/agents/*.test.cjs`), and renderer logic tests are `app/src/lib/*.test.ts`.
  - `npm run test:agent` runs them all: 210 on `main` today, 242 when this plan is done.
  - In the agent's sandboxed shell, `electron/agents/process-tree.test.cjs` hangs on a group kill, so the 207 others were run without it. Run the full suite in a normal terminal.
  - `npm run build` must stay clean (it includes `tsc --noEmit`).
- **Commits.** Every commit message ends with the paragraph `Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5`.

## Review Focus

1. **The login shell hangs, or its output is misread.** Many rc files print banners or run slow version managers, and some hang or `exec` into tmux.
   - Expected: only text between the two random marks counts. A hung shell is killed at 10 s with its process group. A shell that never prints both marks gives nothing, and the install folders still apply.
   - Pinned in Task 1: "reads the login shell's environment between the marks, past whatever rc files print", "gives up on a shell that hangs, and kills its process group", "a shell that exits without printing the environment gives nothing", and "reads PATH from a real bash login shell".
2. **The merged environment breaks the app or reorders `PATH` badly.**
   - Expected: launchd's `HOME`, `TMPDIR` and `SSH_AUTH_SOCK` stay, and shell-only variables are skipped. The shell's folders come first, so Homebrew's tools win over `/usr/bin`'s, as in a terminal. No duplicates or empty entries, and the CLIs are found even when the shell gives nothing.
   - Pinned in Task 1: "merges PATH lists in order, without duplicates or empty entries", "fills in what the app lacks from the login shell, and puts the shell's PATH first", "falls back to the install folders when the shell gives nothing, and leaves Windows alone", and "lists the install folders that exist, with nvm's default node".
3. **A bad result sticks for the whole run.** If a missing, outdated or logged-out CLI were cached, the user would have to restart Milagre after fixing it. The check could also run before the environment is ready, or the Claude minimum could drift from the SDK.
   - Expected: only good results are cached, and the check waits for the environment.
   - Pinned in:
     - Task 3: "each CLI is inspected once per run, after the environment, until it has a problem", and "the Claude minimum is the Claude Code release the pinned SDK is built against";
     - Task 4: "a logged-out Codex fails the turn at once with the login message", which closes the session, so the next message checks again;
     - Task 5: "each agent is asked once per run; a missing CLI or a failed lookup is asked again".
4. **The login message shows when the user is logged in, or doesn't show when they aren't.**
   - Expected: Codex on an API key or a custom provider is not held up. Claude's other failures keep their own text, and a Codex 500 isn't a login problem.
   - Pinned in:
     - Task 4: "a Codex on a provider that needs no OpenAI login isn't held up" and "a logged-out Claude fails the turn with the login message";
     - Task 2: "Claude: a turn it can't authenticate asks to log in" (its third assertion) and "Codex: a turn it can't authenticate asks to log in, and raw API errors read as their message" (the 500 case).
5. **The picker offers a model the CLI rejects, or shows the list wrong.** On codex-cli 0.158.0 an unlisted model fails the turn with a 400.
   - Expected: hidden models and alias duplicates are left out, and the recommended model comes first. A selected or default model that isn't offered gives way to its provider's recommended model once the lists arrive. The maintained list stands in while nothing is reported.
   - Pinned in:
     - Task 5: "Claude's aliases become the models they resolve to, once each, with the default recommended" and "Codex's models keep its names, efforts and default, and drop hidden ones";
     - Task 6: "each agent's own list replaces the maintained one, recommended model first", "the maintained list stands in while nothing is reported, or for an empty list" and "a model no longer offered gives way to its provider's recommended one";
     - Task 9: Steps 1 and 5.

---

### Task 1: Read the login shell's environment

**Files:**
- Modify: `electron/agents/environment.cjs`
- Test: `electron/agents/environment.test.cjs`

**Interfaces:**
- Produces, in `electron/agents/environment.cjs`:
  - `SHELL_TIMEOUT_MS` (10,000).
  - `parseShellEnv(stdout, mark) → Record<string, string> | null`
  - `readLoginShellEnv({ shell, env?, timeoutMs?, spawnImpl?, killGroup? }) → Promise<Record<string, string> | null>`
  - `installDirs(home?, { exists?, readdir?, readFile? }?) → string[]`
  - `mergePath(...lists: Array<string | string[] | undefined>) → string`
  - `loadLoginEnvironment({ target?, platform?, home?, shell?, readShellEnv?, dirs? }?) → Promise<{ source: "shell" | "fallback" | "none" }>`. It mutates `target` (default `process.env`).
  - `resolveExecutable(name, { execFileImpl? }?)`, unchanged.

- [ ] **Step 1: Write the failing tests**

Replace `electron/agents/environment.test.cjs` with:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { installDirs, loadLoginEnvironment, mergePath, readLoginShellEnv, resolveExecutable } = require("./environment.cjs");

// A stand-in for spawn: `script(child, mark)` plays the shell, given the mark the command line asks it to print.
function fakeShell(script) {
  const calls = [];
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    calls.push({ file, args, options });
    const mark = /'(__MILAGRE_ENV_[0-9a-f]+__)'/.exec(args.at(-1))[1];
    setImmediate(() => script(child, mark));
    return child;
  };
  return { spawnImpl, calls };
}
const envBlock = (vars) => Object.entries(vars).map(([key, value]) => `${key}=${value}\0`).join("");

test("returns the first path which reports", async () => {
  const execFileImpl = (file, args, options, callback) => callback(null, "/opt/homebrew/bin/codex\n/usr/local/bin/codex\n");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), "/opt/homebrew/bin/codex");
});

test("returns null when the CLI isn't installed", async () => {
  const execFileImpl = (file, args, options, callback) => callback(Object.assign(new Error("not found"), { code: 1 }), "");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), null);
});

test("reads the login shell's environment between the marks, past whatever rc files print", async () => {
  const { spawnImpl, calls } = fakeShell((child, mark) => {
    child.stdout.write("Welcome back! __MILAGRE_ENV_0000__\nno newline");
    child.stdout.write(`${mark}${envBlock({ PATH: "/opt/homebrew/bin:/usr/bin", LANG: "en_US.UTF-8", NOTE: "two\nlines" })}${mark}bye\n`);
    child.emit("close", 0);
  });
  const env = await readLoginShellEnv({ shell: "/bin/zsh", env: { HOME: "/Users/x" }, spawnImpl });
  assert.deepEqual(env, { PATH: "/opt/homebrew/bin:/usr/bin", LANG: "en_US.UTF-8", NOTE: "two\nlines" });
  assert.equal(calls[0].file, "/bin/zsh");
  assert.deepEqual(calls[0].args.slice(0, 3), ["-i", "-l", "-c"]);
  assert.match(calls[0].args[3], /^\/usr\/bin\/printf '%s' '__MILAGRE_ENV_[0-9a-f]{16}__'; \/usr\/bin\/env -0; /);
  assert.deepEqual(calls[0].options, { env: { HOME: "/Users/x" }, stdio: ["ignore", "pipe", "ignore"], detached: true });
});

test("gives up on a shell that hangs, and kills its process group", async () => {
  const { spawnImpl } = fakeShell(() => {});
  const killed = [];
  const env = await readLoginShellEnv({ shell: "/bin/bash", spawnImpl, timeoutMs: 20, killGroup: (pid) => killed.push(pid) });
  assert.equal(env, null);
  assert.deepEqual(killed, [4242]);
});

test("a shell that exits without printing the environment gives nothing", async () => {
  const { spawnImpl } = fakeShell((child) => {
    child.stdout.write("exec'd into something else\n");
    child.emit("close", 0);
  });
  assert.equal(await readLoginShellEnv({ shell: "/opt/homebrew/bin/fish", spawnImpl }), null);
});

test("shells that can't run the command line aren't started", async () => {
  const { spawnImpl, calls } = fakeShell(() => {});
  assert.equal(await readLoginShellEnv({ shell: "/opt/homebrew/bin/nu", spawnImpl }), null);
  assert.equal(await readLoginShellEnv({ shell: "", spawnImpl }), null);
  assert.equal(calls.length, 0);
});

test("reads PATH from a real bash login shell", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-shell-"));
  fs.writeFileSync(path.join(home, ".bash_profile"), 'echo "Welcome"\nexport PATH="$HOME/from-profile:$PATH"\nexport MILAGRE_TEST_VAR="hi there"\n');
  try {
    const env = await readLoginShellEnv({ shell: "/bin/bash", env: { HOME: home, PATH: "/usr/bin:/bin" } });
    assert.equal(env.PATH.split(":")[0], path.join(home, "from-profile"));
    assert.equal(env.MILAGRE_TEST_VAR, "hi there");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("merges PATH lists in order, without duplicates or empty entries", () => {
  assert.equal(mergePath("/opt/homebrew/bin:/usr/bin::/bin", "/usr/bin:/bin:/usr/sbin:/sbin", ["/Users/x/.local/bin", "/opt/homebrew/bin"]), "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/x/.local/bin");
  assert.equal(mergePath(undefined, "/usr/bin:/bin", []), "/usr/bin:/bin");
});

test("lists the install folders that exist, with nvm's default node", () => {
  const present = new Set(["/Users/x/.local/bin", "/opt/homebrew/bin", "/Users/x/.nvm/versions/node", "/Users/x/.nvm/versions/node/v24.13.0/bin", "/Users/x/.bun/bin"]);
  const deps = (alias) => ({
    exists: (dir) => present.has(dir),
    readdir: () => ["v22.22.0", "v24.2.0", "v24.13.0", ".DS_Store"],
    readFile: () => {
      if (alias === null) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return `${alias}\n`;
    },
  });
  assert.deepEqual(installDirs("/Users/x", deps("24")), ["/Users/x/.local/bin", "/opt/homebrew/bin", "/Users/x/.nvm/versions/node/v24.13.0/bin", "/Users/x/.bun/bin"]);
  present.add("/Users/x/.nvm/versions/node/v22.22.0/bin");
  assert.ok(installDirs("/Users/x", deps("v22.22.0")).includes("/Users/x/.nvm/versions/node/v22.22.0/bin"));
  assert.ok(installDirs("/Users/x", deps("lts/*")).includes("/Users/x/.nvm/versions/node/v24.13.0/bin"));
  assert.ok(installDirs("/Users/x", deps(null)).includes("/Users/x/.nvm/versions/node/v24.13.0/bin"));
});

test("fills in what the app lacks from the login shell, and puts the shell's PATH first", async () => {
  const target = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/Users/x", SHELL: "/bin/zsh", TMPDIR: "/var/folders/app/" };
  const asked = [];
  const readShellEnv = async (options) => {
    asked.push(options.shell);
    return { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: "/elsewhere", TMPDIR: "/tmp/", LANG: "en_US.UTF-8", ANTHROPIC_API_KEY: "key", PWD: "/Users/x", OLDPWD: "/", SHLVL: "2", _: "/usr/bin/env" };
  };
  const result = await loadLoginEnvironment({ target, platform: "darwin", home: "/Users/x", readShellEnv, dirs: () => ["/Users/x/.local/bin", "/opt/homebrew/bin"] });
  assert.deepEqual(result, { source: "shell" });
  assert.deepEqual(asked, ["/bin/zsh"]);
  assert.deepEqual(target, {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/x/.local/bin",
    HOME: "/Users/x",
    SHELL: "/bin/zsh",
    TMPDIR: "/var/folders/app/",
    LANG: "en_US.UTF-8",
    ANTHROPIC_API_KEY: "key",
  });
});

test("falls back to the install folders when the shell gives nothing, and leaves Windows alone", async () => {
  const target = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/zsh" };
  const result = await loadLoginEnvironment({ target, platform: "darwin", home: "/Users/x", readShellEnv: async () => null, dirs: () => ["/Users/x/.local/bin", "/opt/homebrew/bin"] });
  assert.deepEqual(result, { source: "fallback" });
  assert.equal(target.PATH, "/usr/bin:/bin:/usr/sbin:/sbin:/Users/x/.local/bin:/opt/homebrew/bin");

  const windows = { PATH: "C:\\Windows" };
  assert.deepEqual(await loadLoginEnvironment({ target: windows, platform: "win32", readShellEnv: async () => assert.fail("no shell on Windows") }), { source: "none" });
  assert.deepEqual(windows, { PATH: "C:\\Windows" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/environment.test.cjs`
Expected: FAIL. `readLoginShellEnv`, `mergePath`, `installDirs` and `loadLoginEnvironment` are not functions; the two `resolveExecutable` tests pass.

- [ ] **Step 3: Implement the login environment**

Replace `electron/agents/environment.cjs` with:

```js
const { execFile, spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Opened from Finder or the Dock, Milagre gets launchd's environment: PATH is /usr/bin:/bin:/usr/sbin:/sbin
// and nothing the user's shell sets is there, so neither CLI is found and agent commands miss node, gh,
// LANG and the rest. At startup the login shell is asked for its environment once, started the way a
// terminal starts it (`-ilc`), and fills in what the app lacks. PATH is merged instead: the shell's
// folders first, then the app's, then common install folders, so the CLIs are found even when the shell
// can't be read.

const SHELL_TIMEOUT_MS = 10_000;
// Shells that take `-i -l -c` and run the command line below as written. Others aren't started; the
// install folders still apply.
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh"]);
// Set by the throwaway shell itself; they mean nothing to the app.
const SHELL_ONLY = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

// Only absolute commands and `;`, which zsh, bash and fish all read the same way. The random mark keeps
// whatever rc files print (banners, prompts) out of the result.
function shellCommand(mark) {
  return `/usr/bin/printf '%s' '${mark}'; /usr/bin/env -0; /usr/bin/printf '%s' '${mark}'`;
}

// The environment `env -0` printed between the two marks (NUL-separated KEY=value), or null.
function parseShellEnv(stdout, mark) {
  const start = stdout.indexOf(mark);
  const end = start < 0 ? -1 : stdout.indexOf(mark, start + mark.length);
  if (end < 0) return null;
  const env = {};
  for (const entry of stdout.slice(start + mark.length, end).split("\0")) {
    const at = entry.indexOf("=");
    if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return env.PATH ? env : null;
}

// Starts the login shell once. Resolves its environment as soon as the closing mark arrives, or null when
// the shell can't be started, exits without printing it (an rc file that execs something else), or
// outlives the timeout, in which case its whole process group is killed.
function readLoginShellEnv({ shell, env = process.env, timeoutMs = SHELL_TIMEOUT_MS, spawnImpl = spawn, killGroup = (pid) => process.kill(-pid, "SIGKILL") } = {}) {
  if (!shell || !SHELLS.has(path.basename(shell))) return Promise.resolve(null);
  const mark = `__MILAGRE_ENV_${randomBytes(8).toString("hex")}__`;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(shell, ["-i", "-l", "-c", shellCommand(mark)], { env, stdio: ["ignore", "pipe", "ignore"], detached: true });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        killGroup(child.pid);
      } catch {}
      settle(null);
    }, timeoutMs);
    child.stdout.setEncoding?.("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const parsed = parseShellEnv(stdout, mark);
      if (parsed) settle(parsed);
    });
    child.on("error", () => settle(null));
    child.on("close", () => settle(parseShellEnv(stdout, mark)));
  });
}

// nvm's default node, where npm puts global CLIs such as Codex: ~/.nvm/alias/default names a version
// ("24", "v24.13.0"); the newest installed version it matches, or the newest installed for an alias
// such as lts/*.
function nvmBin(home, { exists, readdir, readFile }) {
  const root = path.join(home, ".nvm/versions/node");
  if (!exists(root)) return null;
  let wanted = "";
  try {
    wanted = String(readFile(path.join(home, ".nvm/alias/default"), "utf8")).trim().replace(/^v/, "");
  } catch {}
  const numbers = (name) => name.slice(1).split(".").map(Number);
  const versions = readdir(root).filter((name) => /^v\d+\.\d+\.\d+$/.test(name)).sort((a, b) => {
    const [x, y] = [numbers(a), numbers(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
  const match = (/^\d/.test(wanted) && versions.find((name) => name.slice(1) === wanted || name.slice(1).startsWith(`${wanted}.`))) || versions[0];
  return match ? path.join(root, match, "bin") : null;
}

// Where the CLIs and their tools usually live, for when the shell can't be read or its PATH misses one.
// Only folders that exist.
function installDirs(home = os.homedir(), { exists = fs.existsSync, readdir = fs.readdirSync, readFile = fs.readFileSync } = {}) {
  return [
    path.join(home, ".local/bin"), // Claude Code's native installer
    path.join(home, ".claude/local"), // Claude Code's older local npm install
    "/opt/homebrew/bin", // Homebrew on Apple silicon
    "/usr/local/bin", // Homebrew on Intel, and most installers
    nvmBin(home, { exists, readdir, readFile }),
    path.join(home, ".volta/bin"),
    path.join(home, ".asdf/shims"),
    path.join(home, ".local/share/mise/shims"),
    path.join(home, ".npm-global/bin"), // npm's documented prefix for global installs without sudo
    path.join(home, "Library/pnpm"), // pnpm's default PNPM_HOME on macOS
    path.join(home, ".bun/bin"),
  ].filter((dir) => dir && exists(dir));
}

// Joins PATH lists in order. Each folder keeps its first position; empty entries (the current folder) are dropped.
function mergePath(...lists) {
  const seen = new Set();
  for (const list of lists) {
    for (const dir of Array.isArray(list) ? list : String(list ?? "").split(":")) if (dir) seen.add(dir);
  }
  return [...seen].join(":");
}

function userShell() {
  try {
    return os.userInfo().shell;
  } catch {
    return null;
  }
}

// Fills the app's environment from the login shell, once, at startup. Variables the app already has keep
// their value (HOME, TMPDIR, SSH_AUTH_SOCK from launchd), except PATH, which becomes the shell's folders,
// then the app's, then the install folders.
async function loadLoginEnvironment({ target = process.env, platform = process.platform, home = os.homedir(), shell = target.SHELL || userShell() || "/bin/zsh", readShellEnv = readLoginShellEnv, dirs = installDirs } = {}) {
  if (platform === "win32") return { source: "none" };
  const imported = await readShellEnv({ shell, env: { ...target } });
  for (const [key, value] of Object.entries(imported ?? {})) {
    if (key !== "PATH" && !SHELL_ONLY.has(key) && target[key] === undefined) target[key] = value;
  }
  target.PATH = mergePath(imported?.PATH, target.PATH, dirs(home));
  return { source: imported ? "shell" : "fallback" };
}

// Absolute path of a CLI on the app's PATH, or null when it isn't installed.
function resolveExecutable(name, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl("/usr/bin/which", [name], { encoding: "utf8", timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim().split("\n")[0] || null);
    });
  });
}

module.exports = { SHELL_TIMEOUT_MS, installDirs, loadLoginEnvironment, mergePath, parseShellEnv, readLoginShellEnv, resolveExecutable };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/environment.test.cjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/environment.cjs electron/agents/environment.test.cjs
git commit -m "feat: read the login shell's environment for apps opened from Finder" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 2: Messages that name the fix

**Files:**
- Modify: `electron/agents/events.cjs`
- Test: `electron/agents/events.test.cjs`

**Interfaces:**
- Produces, in `electron/agents/events.cjs`:
  - `missingCliMessage(name)` (new copy), `cliTooOldMessage(name, version, minimum)`, `cliBrokenMessage(name, command, detail)`, `loginMessage(name)`, `crashMessage(name, detail)`, where `name` is `"claude" | "codex"`.
  - `lastLine(text) → string`
  - `mapClaudeMessage` sets `state.authFailed` on an `authentication_failed` assistant message. The next failed `result` becomes `loginMessage("claude")`, and the flag resets.
  - `mapCodexNotification` maps a failed turn with a 401 or `"unauthorized"` to `loginMessage("codex")`, and a raw JSON error to its `error.message`.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/events.test.cjs`:

1. Replace the `./events.cjs` require with:

```js
const { MILAGRE_INSTRUCTIONS, cliBrokenMessage, cliTooOldMessage, crashMessage, isTerminal, lastLine, loginMessage, mapClaudeMessage, mapCodexNotification, missingCliMessage } = require("./events.cjs");
```

2. Add before `test("Codex: a stale completion or text for another turn id is ignored", …)`:

```js
test("CLI failures name the fix", () => {
  assert.equal(missingCliMessage("claude"), "Milagre couldn't find Claude Code. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, then send your message again.");
  assert.equal(missingCliMessage("codex"), "Milagre couldn't find Codex. Install it with `npm install -g @openai/codex`, then send your message again.");
  assert.equal(cliTooOldMessage("claude", "2.1.200", "2.1.286"), "Milagre needs Claude Code 2.1.286 or later, and you have 2.1.200. Run `claude update` in a terminal, then send your message again.");
  assert.equal(cliTooOldMessage("codex", "0.150.0", "0.158.0"), "Milagre needs Codex 0.158.0 or later, and you have 0.150.0. Run `codex update` in a terminal, then send your message again.");
  assert.equal(cliBrokenMessage("codex", "/Users/x/.nvm/versions/node/v24.13.0/bin/codex", "env: node: No such file or directory\n"), "Codex (/Users/x/.nvm/versions/node/v24.13.0/bin/codex) didn't start: env: node: No such file or directory. Check that it runs in a terminal, then send your message again.");
  assert.equal(loginMessage("claude"), "Claude Code isn't logged in. Run `claude auth login` in a terminal, then send your message again.");
  assert.equal(loginMessage("codex"), "Codex isn't logged in. Run `codex login` in a terminal, then send your message again.");
  assert.equal(crashMessage("claude", "Claude Code process terminated by signal SIGKILL"), "Claude Code stopped unexpectedly: Claude Code process terminated by signal SIGKILL. Send your message again to continue this chat.");
  assert.equal(crashMessage("codex", "Codex exited with code null (SIGKILL)."), "Codex stopped unexpectedly: Codex exited with code null (SIGKILL). Send your message again to continue this chat.");
  assert.equal(crashMessage("claude", ""), "Claude Code stopped unexpectedly. Send your message again to continue this chat.");
});

test("lastLine keeps the last thing a CLI printed, without colours", () => {
  assert.equal(lastLine("\x1b[2m2026-10-01T23:30:17Z\x1b[0m \x1b[31mERROR\x1b[0m connecting\nthread 'main' panicked at core.rs\n\n"), "thread 'main' panicked at core.rs");
  assert.equal(lastLine("x".repeat(400)).length, 300);
  assert.equal(lastLine(undefined), "");
});

test("Claude: a turn it can't authenticate asks to log in", () => {
  const state = claudeState();
  const notLoggedIn = { type: "assistant", error: "authentication_failed", parent_tool_use_id: null, message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] } };
  assert.deepEqual(mapClaudeMessage(notLoggedIn, state), []);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }, state), [{ type: "turn-failed", message: loginMessage("claude") }]);
  assert.deepEqual(mapClaudeMessage({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" }, state), [{ type: "turn-failed", message: "Credit balance is too low" }]);
});

test("Codex: a turn it can't authenticate asks to log in, and raw API errors read as their message", () => {
  const failed = (error) => mapCodexNotification("turn/completed", { threadId: "thread-1", turn: { id: "t-1", status: "failed", error } }, codexState());
  const unauthorized = { message: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } };
  assert.deepEqual(failed(unauthorized), [{ type: "turn-failed", message: loginMessage("codex") }]);
  assert.deepEqual(failed({ message: "Unauthorized", codexErrorInfo: "unauthorized" }), [{ type: "turn-failed", message: loginMessage("codex") }]);
  const unsupported = JSON.stringify({ type: "error", status: 400, error: { type: "invalid_request_error", message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } });
  assert.deepEqual(failed({ message: unsupported, codexErrorInfo: null }), [{ type: "turn-failed", message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." }]);
  assert.deepEqual(failed({ message: "stream disconnected", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 500 } } }), [{ type: "turn-failed", message: "stream disconnected" }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/events.test.cjs`
Expected: FAIL. `cliTooOldMessage` is not a function, and `missingCliMessage` returns the old copy.

- [ ] **Step 3: Write the messages and map the login failures**

In `electron/agents/events.cjs`:

1. Replace the `missingCliMessage` function with:

```js
// What a turn fails with when an agent's CLI can't run it. Each names the fix; the next message checks again.
const CLI_NAMES = { claude: "Claude Code", codex: "Codex" };
const INSTALL_COMMANDS = { claude: "curl -fsSL https://claude.ai/install.sh | bash", codex: "npm install -g @openai/codex" };
const UPDATE_COMMANDS = { claude: "claude update", codex: "codex update" };
const LOGIN_COMMANDS = { claude: "claude auth login", codex: "codex login" };

// The last line a CLI printed, without terminal colours, for an error message.
function lastLine(text) {
  const line = String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

const withoutPeriod = (text) => text.replace(/\.$/, "");

function missingCliMessage(name) {
  return `Milagre couldn't find ${CLI_NAMES[name]}. Install it with \`${INSTALL_COMMANDS[name]}\`, then send your message again.`;
}

function cliTooOldMessage(name, version, minimum) {
  return `Milagre needs ${CLI_NAMES[name]} ${minimum} or later, and you have ${version}. Run \`${UPDATE_COMMANDS[name]}\` in a terminal, then send your message again.`;
}

function cliBrokenMessage(name, command, detail) {
  const reason = lastLine(detail);
  return `${CLI_NAMES[name]} (${command}) didn't start${reason ? `: ${withoutPeriod(reason)}` : ""}. Check that it runs in a terminal, then send your message again.`;
}

function loginMessage(name) {
  return `${CLI_NAMES[name]} isn't logged in. Run \`${LOGIN_COMMANDS[name]}\` in a terminal, then send your message again.`;
}

function crashMessage(name, detail) {
  const reason = lastLine(detail);
  return `${CLI_NAMES[name]} stopped unexpectedly${reason ? `: ${withoutPeriod(reason)}` : ""}. Send your message again to continue this chat.`;
}

// Codex passes some API errors on as raw JSON: {"type":"error","status":400,"error":{"message":"…"}}.
function codexErrorText(error) {
  const message = error?.message || "Codex could not finish this turn.";
  try {
    return JSON.parse(message)?.error?.message || message;
  } catch {
    return message;
  }
}

// A turn Codex couldn't authenticate: codexErrorInfo is "unauthorized", or an HTTP failure with status 401.
function codexUnauthorized(error) {
  const info = error?.codexErrorInfo;
  return info === "unauthorized" || (Boolean(info) && typeof info === "object" && Object.values(info).some((detail) => detail?.httpStatusCode === 401));
}
```

2. In `mapClaudeMessage`, add right after `const events = [];`:

```js
  // Claude Code answers a turn it can't authenticate with a reply of its own ("Not logged in · Please run
  // /login") marked authentication_failed, then a failed result.
  if (message.type === "assistant" && message.error === "authentication_failed") state.authFailed = true;
```

3. In `mapClaudeMessage`'s `result` branch, replace the `else events.push(…)` line with:

```js
    else events.push({ type: "turn-failed", message: state.authFailed ? loginMessage("claude") : (message.errors?.length ? message.errors.join("\n") : message.result) || "Claude could not finish this turn." });
    state.authFailed = false;
```

4. In `mapCodexNotification`, replace the `if (turn.status === "failed") …` line with:

```js
    if (turn.status === "failed") return [{ type: "turn-failed", message: codexUnauthorized(turn.error) ? loginMessage("codex") : codexErrorText(turn.error) }];
```

5. Replace the `module.exports` line with:

```js
module.exports = { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, cliBrokenMessage, cliTooOldMessage, crashMessage, isTerminal, lastLine, loginMessage, mapClaudeMessage, mapCodexNotification, missingCliMessage };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/events.test.cjs electron/agents/claude-provider.test.cjs electron/agents/codex-provider.test.cjs`
Expected: PASS. `events.test.cjs` has 14 tests. The providers' "explains a missing CLI" tests compare against `missingCliMessage(...)`, so they follow the new copy.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/events.cjs electron/agents/events.test.cjs
git commit -m "feat: name the fix when an agent CLI is missing, outdated or logged out" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 3: Check each CLI and its version

**Files:**
- Create: `electron/agents/cli.cjs`
- Test: `electron/agents/cli.test.cjs`

**Interfaces:**
- Consumes: `resolveExecutable` from Task 1; `missingCliMessage`, `cliTooOldMessage`, `cliBrokenMessage`, `lastLine` from Task 2.
- Produces, in `electron/agents/cli.cjs`:
  - `MIN_VERSIONS = { claude: "2.1.286", codex: "0.158.0" }`
  - `parseVersion(text) → [major, minor, patch] | null`
  - `isAtLeast(version: number[], minimum: string) → boolean`
  - `runVersion(command, { execFileImpl? }?) → Promise<{ output } | { error }>`
  - `inspectCli(name, { resolve?, version? }?) → Promise<CliStatus>`, where `CliStatus = { command: string | null, version: string | null, problem?: string }`.
  - `createCliCache({ ready?, inspect? }?) → (name) => Promise<CliStatus>`

- [ ] **Step 1: Write the failing tests**

Create `electron/agents/cli.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { MIN_VERSIONS, createCliCache, inspectCli, isAtLeast, parseVersion, runVersion } = require("./cli.cjs");
const { cliBrokenMessage, cliTooOldMessage, missingCliMessage } = require("./events.cjs");

test("reads the version each CLI prints", () => {
  assert.deepEqual(parseVersion("2.1.287 (Claude Code)\n"), [2, 1, 287]);
  assert.deepEqual(parseVersion("codex-cli 0.158.0\n"), [0, 158, 0]);
  assert.deepEqual(parseVersion("codex-cli 0.160.0-alpha.2"), [0, 160, 0]);
  assert.equal(parseVersion("Claude Code"), null);
});

test("compares versions part by part", () => {
  assert.equal(isAtLeast([2, 1, 286], "2.1.286"), true);
  assert.equal(isAtLeast([2, 1, 285], "2.1.286"), false);
  assert.equal(isAtLeast([2, 2, 0], "2.1.286"), true);
  assert.equal(isAtLeast([2, 0, 77], "2.1.286"), false);
  assert.equal(isAtLeast([0, 157, 9], "0.158.0"), false);
  assert.equal(isAtLeast([0, 160, 0], "0.158.0"), true);
  assert.equal(isAtLeast([1, 0, 0], "0.158.0"), true);
});

test("the Claude minimum is the Claude Code release the pinned SDK is built against", () => {
  const sdk = JSON.parse(fs.readFileSync(path.join(__dirname, "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8"));
  assert.equal(MIN_VERSIONS.claude, sdk.claudeCodeVersion);
});

test("runs --version and keeps the last line of a failure", async () => {
  const calls = [];
  const ok = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, "codex-cli 0.158.0\n", "");
  };
  assert.deepEqual(await runVersion("/bin/codex", { execFileImpl: ok }), { output: "codex-cli 0.158.0\n" });
  assert.deepEqual(calls, [{ file: "/bin/codex", args: ["--version"], options: { encoding: "utf8", timeout: 10000 } }]);
  const broken = (file, args, options, callback) => callback(Object.assign(new Error("Command failed: /bin/codex --version"), { code: 127 }), "", "env: node: No such file or directory\n");
  assert.deepEqual(await runVersion("/bin/codex", { execFileImpl: broken }), { error: "env: node: No such file or directory" });
});

test("a missing, outdated or broken CLI comes with the message the turn fails with", async () => {
  const resolve = async (name) => (name === "codex" ? null : "/Users/x/.local/bin/claude");
  assert.deepEqual(await inspectCli("codex", { resolve }), { command: null, version: null, problem: missingCliMessage("codex") });
  assert.deepEqual(await inspectCli("claude", { resolve, version: async () => ({ output: "2.1.200 (Claude Code)" }) }), { command: "/Users/x/.local/bin/claude", version: "2.1.200", problem: cliTooOldMessage("claude", "2.1.200", "2.1.286") });
  assert.deepEqual(await inspectCli("claude", { resolve, version: async () => ({ error: "Killed: 9" }) }), { command: "/Users/x/.local/bin/claude", version: null, problem: cliBrokenMessage("claude", "/Users/x/.local/bin/claude", "Killed: 9") });
});

test("a current CLI, or one whose version can't be read, is used as is", async () => {
  const resolve = async () => "/opt/homebrew/bin/codex";
  assert.deepEqual(await inspectCli("codex", { resolve, version: async () => ({ output: "codex-cli 0.158.0\n" }) }), { command: "/opt/homebrew/bin/codex", version: "0.158.0" });
  assert.deepEqual(await inspectCli("codex", { resolve, version: async () => ({ output: "codex-cli dev build" }) }), { command: "/opt/homebrew/bin/codex", version: null });
});

test("each CLI is inspected once per run, after the environment, until it has a problem", async () => {
  const order = [];
  let release;
  const environment = new Promise((resolve) => { release = resolve; });
  const statuses = { claude: [{ command: "/c", version: "2.1.287" }], codex: [{ command: null, version: null, problem: "missing" }, { command: "/x", version: "0.158.0" }] };
  const cli = createCliCache({
    ready: () => environment.then(() => order.push("environment")),
    inspect: async (name) => {
      order.push(name);
      return statuses[name].shift();
    },
  });
  const first = Promise.all([cli("claude"), cli("claude"), cli("codex")]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  release();
  const [claude, again, codex] = await first;
  assert.equal(claude, again);
  assert.equal(codex.problem, "missing");
  assert.deepEqual(await cli("codex"), { command: "/x", version: "0.158.0" });
  assert.deepEqual(await cli("claude"), { command: "/c", version: "2.1.287" });
  assert.deepEqual(order, ["environment", "environment", "claude", "codex", "environment", "codex"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/cli.test.cjs`
Expected: FAIL with `Cannot find module './cli.cjs'`.

- [ ] **Step 3: Implement `cli.cjs`**

Create `electron/agents/cli.cjs`:

```js
const { execFile } = require("node:child_process");
const { resolveExecutable } = require("./environment.cjs");
const { cliBrokenMessage, cliTooOldMessage, lastLine, missingCliMessage } = require("./events.cjs");

// Finds each agent's CLI and checks it against the oldest version Milagre supports:
//   claude  2.1.286, the Claude Code release @anthropic-ai/claude-agent-sdk 0.3.286 is built against
//           (its package.json `claudeCodeVersion`); 2.0.77 rejects the SDK's --effort flag outright.
//   codex   0.158.0, the release Milagre's use of the app-server protocol was verified against.
// `--version` prints "2.1.287 (Claude Code)" and "codex-cli 0.158.0".
const MIN_VERSIONS = { claude: "2.1.286", codex: "0.158.0" };
const VERSION_TIMEOUT_MS = 10_000;

// [major, minor, patch] from the first x.y.z in the text, or null.
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

function isAtLeast(version, minimum) {
  const wanted = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) if (version[index] !== wanted[index]) return version[index] > wanted[index];
  return true;
}

// `<command> --version`: { output }, or { error } with the last line it printed when it didn't run.
function runVersion(command, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl(command, ["--version"], { encoding: "utf8", timeout: VERSION_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve(error ? { error: lastLine(stderr) || lastLine(error.message) } : { output: String(stdout) });
    });
  });
}

// { command, version } for a CLI Milagre can run, plus `problem`, the message a turn fails with, when it is
// missing, too old or doesn't start. A version Milagre can't read is no reason to refuse the CLI.
async function inspectCli(name, { resolve = resolveExecutable, version = runVersion } = {}) {
  const command = await resolve(name);
  if (!command) return { command: null, version: null, problem: missingCliMessage(name) };
  const result = await version(command);
  if (result.error !== undefined) return { command, version: null, problem: cliBrokenMessage(name, command, result.error) };
  const parsed = parseVersion(result.output);
  if (!parsed) return { command, version: null };
  const text = parsed.join(".");
  return isAtLeast(parsed, MIN_VERSIONS[name]) ? { command, version: text } : { command, version: text, problem: cliTooOldMessage(name, text, MIN_VERSIONS[name]) };
}

// Each CLI is inspected once per app run, after `ready` (the login environment). One with a problem is
// inspected again on the next call, so installing, updating or fixing it needs no restart.
function createCliCache({ ready = () => undefined, inspect = inspectCli } = {}) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      const pending = Promise.resolve().then(ready).catch(() => {}).then(() => inspect(name)).then((status) => {
        if (status.problem) cache.delete(name);
        return status;
      }, (error) => {
        cache.delete(name);
        throw error;
      });
      cache.set(name, pending);
    }
    return cache.get(name);
  };
}

module.exports = { MIN_VERSIONS, createCliCache, inspectCli, isAtLeast, parseVersion, runVersion };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/cli.test.cjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/cli.cjs electron/agents/cli.test.cjs
git commit -m "feat: check each agent CLI and its version once per run" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 4: Login and crash messages in the providers

**Files:**
- Modify: `electron/agents/claude-provider.cjs`, `electron/agents/codex-provider.cjs`, `electron/agents/fixtures/fake-app-server.cjs`
- Test: `electron/agents/claude-provider.test.cjs`, `electron/agents/codex-provider.test.cjs`

**Interfaces:**
- Consumes: `crashMessage` and `loginMessage` from Task 2.
- Produces:
  - `ClaudeSession#handleEnd` fails a turn whose process died with `crashMessage("claude", error.message || stderr)`.
  - `CodexSession#checkLogin(rpc)`, called in `start()` after `initialized` and before the thread. It throws `loginMessage("codex")` for `{ account: null, requiresOpenaiAuth: true }`.
  - `CodexSession#handleExit` fails the turn with `crashMessage("codex", detail)`.
  - The fake app-server answers `account/read` (scenarios `logged-out` and `custom-provider`) and `model/list` (two pages, the second with a hidden model).

- [ ] **Step 1: Teach the fake app-server about accounts and models**

In `electron/agents/fixtures/fake-app-server.cjs`, add right after `case "initialized":` and its `return undefined;`:

```js
    // logged-out: no login while OpenAI auth is required; custom-provider: a provider that needs no OpenAI login.
    case "account/read":
      if (scenario === "logged-out") return send({ id, result: { account: null, requiresOpenaiAuth: true } });
      if (scenario === "custom-provider") return send({ id, result: { account: null, requiresOpenaiAuth: false } });
      return send({ id, result: { account: { type: "chatgpt", email: null, planType: "pro" }, requiresOpenaiAuth: true } });
    // Two pages, the second with a hidden model, as model/list pages with nextCursor.
    case "model/list":
      if (!params.cursor) return send({ id, result: { data: [{ id: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Frontier intelligence.", hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "ultra" }], defaultReasoningEffort: "medium" }], nextCursor: "page-2" } });
      return send({ id, result: { data: [{ id: "gpt-6-luna", displayName: "GPT-6-Luna", description: "Fast.", hidden: false, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }, { id: "codex-auto-review", displayName: "Codex Auto Review", description: "Review model.", hidden: true, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" }], nextCursor: null } });
```

- [ ] **Step 2: Write the failing tests**

In `electron/agents/claude-provider.test.cjs`:

1. Replace the `./events.cjs` require with:

```js
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, crashMessage, isTerminal, loginMessage, missingCliMessage } = require("./events.cjs");
```

2. In `test("reports a crash mid-turn", …)`, replace the `events.at(-1)` assertion with:

```js
  assert.deepEqual(events.at(-1), { type: "turn-failed", message: crashMessage("claude", "Claude Code process exited with code 1") });
```

3. In `test("keeps the saved session when a resumed start fails for another reason", …)`, replace the assertion with:

```js
  assert.deepEqual(events.slice(1), [{ type: "turn-failed", message: crashMessage("claude", "spawn EACCES") }]);
```

4. Add before `test("explains a missing CLI without starting anything", …)`:

```js
test("a logged-out Claude fails the turn with the login message", async (t) => {
  // Recorded from Claude Code 2.1.287 with an empty CLAUDE_CONFIG_DIR.
  const script = async function* () {
    yield init;
    yield { type: "assistant", error: "authentication_failed", parent_tool_use_id: null, message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] } };
    yield { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" };
  };
  const { session, events } = claude(t, { script });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-failed", message: loginMessage("claude") });
  assert.equal(events.some((event) => event.type === "text-delta"), false);
});
```

In `electron/agents/codex-provider.test.cjs`:

1. Replace the `./events.cjs` require with:

```js
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, crashMessage, isTerminal, loginMessage, missingCliMessage } = require("./events.cjs");
```

2. In `test("reports a failed turn and a crashed process", …)`, replace `assert.match(crashed.events.at(-1).message, /boom: model unavailable/);` with:

```js
  assert.deepEqual(crashed.events.at(-1), { type: "turn-failed", message: crashMessage("codex", "boom: model unavailable") });
```

3. Add before `test("explains a missing CLI without starting anything", …)`:

```js
test("a logged-out Codex fails the turn at once with the login message", async (t) => {
  const { session, events } = codex(t, { scenario: "logged-out" });
  await session.startTurn(TURN);
  assert.deepEqual(events, [{ type: "turn-failed", message: loginMessage("codex") }]);
  assert.equal(session.closed, true);
});

test("a Codex on a provider that needs no OpenAI login isn't held up", async (t) => {
  const { session, events } = codex(t, { scenario: "custom-provider" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.at(-1), { type: "turn-completed" });
  assert.deepEqual((await received(session)).map((message) => message.method).slice(0, 4), ["initialize", "initialized", "account/read", "thread/start"]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test electron/agents/claude-provider.test.cjs electron/agents/codex-provider.test.cjs`
Expected: FAIL in five tests:
- the two Claude crash assertions, which still get the raw message;
- both new Codex tests, since no `account/read` is sent yet;
- "reports a failed turn and a crashed process", which gets "Codex stopped: …".

"a logged-out Claude fails the turn with the login message" passes already (Task 2 maps it). It stays as the provider-level pin.

- [ ] **Step 4: Use the messages in the providers**

In `electron/agents/claude-provider.cjs`:

1. Replace the `./events.cjs` require with:

```js
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, crashMessage, isTerminal, mapClaudeMessage, missingCliMessage } = require("./events.cjs");
```

2. In `handleEnd`, replace the last line (`else this.finishTurn({ type: "turn-failed", message: error?.message || this.stderr.trim() || "Claude Code stopped unexpectedly." });`) with:

```js
    else this.finishTurn({ type: "turn-failed", message: crashMessage("claude", error?.message || this.stderr) });
```

In `electron/agents/codex-provider.cjs`:

1. Replace the `./events.cjs` require with:

```js
const { MILAGRE_INSTRUCTIONS, RESUME_FAILED_MESSAGE, crashMessage, isTerminal, loginMessage, mapCodexNotification, missingCliMessage } = require("./events.cjs");
```

2. In `start()`, add a line right after `rpc.notify("initialized");`:

```js
    await this.checkLogin(rpc);
```

3. Add this method right above the `// Codex ignores a feature it doesn't know, …` comment of `requestThread`:

```js
  // A logged-out Codex accepts a turn, retries for about 15 s and fails it with a raw 401. account/read
  // answers at once: no account while OpenAI auth is required means `codex login` is needed. A Codex that
  // can't answer, or one on a provider that needs no OpenAI login, isn't held up.
  async checkLogin(rpc) {
    const status = await rpc.request("account/read", { refreshToken: false }).catch(() => null);
    if (status && !status.account && status.requiresOpenaiAuth === true) throw new Error(loginMessage("codex"));
  }

```

4. In `handleExit`, replace the `void this.finishTurn(…)` line with:

```js
    void this.finishTurn([this.cancelRequested ? { type: "turn-cancelled" } : { type: "turn-failed", message: crashMessage("codex", detail) }]);
```

The error from `checkLogin` reaches `beginTurn`'s existing `catch`. That ends the turn with the message and closes the session (it isn't `ready`), so the next message starts a new session and checks again.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test electron/agents/claude-provider.test.cjs electron/agents/codex-provider.test.cjs electron/agents/session-manager.test.cjs electron/agents/codex-rpc.test.cjs`
Expected: PASS. Claude has one test more and Codex two more than before.

- [ ] **Step 6: Commit**

```bash
git add electron/agents/claude-provider.cjs electron/agents/codex-provider.cjs electron/agents/fixtures/fake-app-server.cjs electron/agents/claude-provider.test.cjs electron/agents/codex-provider.test.cjs
git commit -m "feat: tell a logged-out or crashed agent apart in the chat" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 5: Ask each CLI for its models

**Files:**
- Create: `electron/agents/models.cjs`
- Test: `electron/agents/models.test.cjs`

`capabilities.cjs` and its test stay until Task 7 switches `main.cjs` over, so the app keeps working between tasks.

**Interfaces:**
- Consumes: `CodexRpc` from `codex-rpc.cjs`; the fake app-server's `model/list` from Task 4. Task 7 passes a `cli` built from Task 3.
- Produces, in `electron/agents/models.cjs`:
  - `claudeCapability(info) → { efforts, ultracode }` (moved from `capabilities.cjs`).
  - `claudeModels(infos) → ReportedModel[]` and `codexModels(entries) → ReportedModel[]`, where `ReportedModel = { id, name, description, recommended, efforts, defaultEffort?, ultracode }`.
  - `listClaudeModels({ command, loadSdk? })` and `listCodexModels({ command, cwd, clientVersion?, createRpc? })`.
  - `createModelCache({ cli, cwd, clientVersion, list? }) → () => Promise<{ claude: ReportedModel[] | null, codex: ReportedModel[] | null }>`

- [ ] **Step 1: Write the failing tests**

Create `electron/agents/models.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { claudeCapability, claudeModels, codexModels, createModelCache, listClaudeModels, listCodexModels } = require("./models.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const FULL = ["low", "medium", "high", "xhigh", "max"];

// Rows of supportedModels() from Claude Code 2.1.287.
const CLAUDE_ROWS = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "For complex work and everyday tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable 5.1", description: "For your toughest challenges", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus 5.5 (1M context)", description: "For long sessions", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "Fastest for quick answers" },
  { value: "claude-opus-5", resolvedModel: "claude-opus-5", displayName: "Opus 5", description: "Best for everyday, complex tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "claude-sonnet-4-6", resolvedModel: "claude-sonnet-4-6", displayName: "Sonnet 4.6", description: "Efficient for routine tasks", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "max"] },
];

test("a Claude model with the full effort range offers ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }), { efforts: ["low", "medium", "high", "xhigh", "max"], ultracode: true });
});

test("a Claude model without xhigh keeps its levels but not ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] }), { efforts: ["low", "medium", "high"], ultracode: false });
});

test("a Claude model without effort support has no levels", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: false, supportedEffortLevels: ["low"] }), { efforts: [], ultracode: false });
  assert.deepEqual(claudeCapability({}), { efforts: [], ultracode: false });
});

test("Claude's aliases become the models they resolve to, once each, with the default recommended", () => {
  assert.deepEqual(claudeModels(CLAUDE_ROWS), [
    { id: "claude-opus-5-5", name: "Opus 5.5", description: "For complex work and everyday tasks", recommended: true, efforts: FULL, ultracode: true },
    { id: "claude-fable-5-1", name: "Fable 5.1", description: "For your toughest challenges", recommended: false, efforts: FULL, ultracode: true },
    { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Fastest for quick answers", recommended: false, efforts: [], ultracode: false },
    { id: "claude-opus-5", name: "Opus 5", description: "Best for everyday, complex tasks", recommended: false, efforts: FULL, ultracode: true },
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6", description: "Efficient for routine tasks", recommended: false, efforts: ["low", "medium", "high", "max"], ultracode: false },
  ]);
  assert.deepEqual(claudeModels([{ value: "opus", displayName: "Opus" }]), []);
});

test("Codex's models keep its names, efforts and default, and drop hidden ones", () => {
  const entries = [
    { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Frontier intelligence for the most demanding work.", hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "ultra", description: "Parallel" }], defaultReasoningEffort: "medium", upgrade: null, upgradeInfo: null },
    { id: "gpt-reserve", displayName: "GPT-Reserve", description: "Fast and affordable agentic coding model.", hidden: true, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" },
    { id: "gpt-5.5", displayName: "", description: "Legacy coding model.", hidden: false, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: null },
  ];
  assert.deepEqual(codexModels(entries), [
    { id: "gpt-6-astra", name: "GPT-6-Astra", description: "Frontier intelligence for the most demanding work", recommended: true, efforts: ["low", "ultra"], defaultEffort: "medium", ultracode: false },
    { id: "gpt-5.5", name: "gpt-5.5", description: "Legacy coding model", recommended: false, efforts: ["low"], ultracode: false },
  ]);
});

test("Codex's model list is read page by page from the app-server", async () => {
  const models = await listCodexModels({ command: process.execPath, cwd: os.tmpdir(), createRpc: (options) => new CodexRpc({ ...options, args: [FAKE] }) });
  assert.deepEqual(models.map((model) => model.id), ["gpt-6-astra", "gpt-6-luna"]);
});

test("Claude's model list comes from an idle query that is closed afterwards", async () => {
  const calls = { closed: 0, options: null };
  const loadSdk = async () => ({
    query: ({ options }) => {
      calls.options = options;
      return { supportedModels: async () => CLAUDE_ROWS.slice(0, 3), close: () => { calls.closed += 1; } };
    },
  });
  const models = await listClaudeModels({ command: "/Users/x/.local/bin/claude", loadSdk });
  assert.deepEqual(models.map((model) => model.id), ["claude-opus-5-5", "claude-fable-5-1"]);
  assert.deepEqual(calls, { closed: 1, options: { pathToClaudeCodeExecutable: "/Users/x/.local/bin/claude" } });
});

test("each agent is asked once per run; a missing CLI or a failed lookup is asked again", async () => {
  const asked = { claude: 0, codex: 0 };
  const statuses = { claude: [{ command: "/c", version: "2.1.287" }], codex: [{ command: null, version: null, problem: "missing" }, { command: "/x", version: "0.158.0" }] };
  const cli = async (provider) => statuses[provider][0].problem ? statuses[provider].shift() : statuses[provider][0];
  let codexFails = true;
  const list = {
    claude: async () => { asked.claude += 1; return [{ id: "claude-opus-5-5" }]; },
    codex: async ({ command }) => {
      asked.codex += 1;
      assert.equal(command, "/x");
      if (codexFails) {
        codexFails = false;
        throw new Error("Codex did not answer model/list within 30 s.");
      }
      return [{ id: "gpt-6-astra" }];
    },
  };
  const models = createModelCache({ cli, cwd: "/tmp", clientVersion: "1.0.0", list });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: [{ id: "gpt-6-astra" }] });
  assert.deepEqual(asked, { claude: 1, codex: 2 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/models.test.cjs`
Expected: FAIL with `Cannot find module './models.cjs'`.

- [ ] **Step 3: Implement `models.cjs`**

Create `electron/agents/models.cjs`:

```js
const { CodexRpc } = require("./codex-rpc.cjs");

// The models each agent offers, asked from its CLI once per app run: Claude's supportedModels() and
// Codex's model/list. A model is { id, name, description, recommended, efforts, defaultEffort?, ultracode },
// where `efforts` are the levels it accepts, lightest first (none when it has no effort control).

// "claude-haiku-4-5-20251001" and "claude-opus-5-5[1m]" are the picker's "claude-haiku-4-5" and "claude-opus-5-5".
const plainId = (id) => String(id ?? "").replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
// Codex ends its descriptions with a period; Claude's and the picker's have none.
const sentence = (text) => String(text ?? "").trim().replace(/\.$/, "");

// Claude reports no ultracode flag. Ultracode needs a model with the full effort range, so
// models that offer xhigh are treated as ultracode-capable.
function claudeCapability(info) {
  const efforts = info.supportsEffort ? info.supportedEffortLevels ?? [] : [];
  return { efforts, ultracode: efforts.includes("xhigh") };
}

// supportedModels() lists aliases first (default, opus, fable, sonnet, haiku), each resolving to a model,
// then older models by id. The picker lists models by id, so a chat keeps its model when an alias moves
// on to a newer one; "default" only says which model Claude Code recommends.
function claudeModels(infos) {
  const recommended = plainId(infos.find((info) => info.value === "default")?.resolvedModel);
  const models = new Map();
  for (const info of infos) {
    const id = plainId(String(info.value).startsWith("claude-") ? info.value : info.resolvedModel);
    if (info.value === "default" || !id.startsWith("claude-") || models.has(id)) continue;
    models.set(id, { id, name: info.displayName || id, description: sentence(info.description), recommended: id === recommended, ...claudeCapability(info) });
  }
  return [...models.values()];
}

// model/list leaves hidden models out unless asked for them; any that come anyway are dropped.
function codexModels(entries) {
  return entries.filter((model) => model?.id && model.hidden !== true).map((model) => ({
    id: model.id,
    name: model.displayName || model.id,
    description: sentence(model.description),
    recommended: model.isDefault === true,
    efforts: (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort ?? option),
    ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
    ultracode: false,
  }));
}

async function listClaudeModels({ command, loadSdk = () => import("@anthropic-ai/claude-agent-sdk") }) {
  const { query } = await loadSdk();
  const idle = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } };
  const session = query({ prompt: idle, options: { pathToClaudeCodeExecutable: command } });
  try {
    return claudeModels(await session.supportedModels());
  } finally {
    session.close?.();
  }
}

async function listCodexModels({ command, cwd, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
  const rpc = createRpc({ command, cwd });
  rpc.start();
  try {
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const entries = [];
    let cursor = null;
    do {
      const page = await rpc.request("model/list", cursor ? { cursor } : {});
      entries.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return codexModels(entries);
  } finally {
    rpc.close();
  }
}

/**
 * Asks each agent's CLI once per run. An agent whose CLI has a problem (missing, too old) or whose lookup
 * fails or comes back empty reports null, and is asked again on the next call.
 */
function createModelCache({ cli, cwd, clientVersion, list = { claude: listClaudeModels, codex: listCodexModels } }) {
  const cache = new Map();
  function lookup(provider) {
    if (!cache.has(provider)) {
      const pending = cli(provider)
        .then((status) => (status.problem || !status.command ? null : list[provider]({ command: status.command, cwd, clientVersion })))
        .catch(() => null)
        .then((models) => {
          if (models?.length) return models;
          cache.delete(provider);
          return null;
        });
      cache.set(provider, pending);
    }
    return cache.get(provider);
  }
  return async () => {
    const [claude, codex] = await Promise.all([lookup("claude"), lookup("codex")]);
    return { claude, codex };
  };
}

module.exports = { claudeCapability, claudeModels, codexModels, createModelCache, listClaudeModels, listCodexModels };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/models.test.cjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/models.cjs electron/agents/models.test.cjs
git commit -m "feat: ask Claude and Codex for the models they offer" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 6: Merge the reported models in the renderer

**Files:**
- Modify: `app/src/model.ts`
- Create: `app/src/lib/models.ts`
- Test: `app/src/lib/models.test.ts`

**Interfaces:**
- Produces:
  - In `app/src/model.ts`: `ReportedModel` (extends `ModelCapability` with `id`, `name`, `description`, `recommended`), `AgentModels = Record<ModelProvider, ReportedModel[] | null>`, and the refreshed `MODEL_CATALOG`.
  - In `app/src/lib/models.ts`:
    - `mergeModels(reported: AgentModels | null, fallback: ModelOption[]): ModelOption[]`
    - `capabilitiesFrom(reported: AgentModels | null): ModelCapabilities | null`
    - `resolveModel(models: ModelOption[], wanted: string | undefined, provider: ModelProvider): ModelOption`

- [ ] **Step 1: Refresh the maintained list and add the types**

In `app/src/model.ts`, replace the whole `export const MODEL_CATALOG: ModelOption[] = [ … ];` with:

```ts
/**
 * The maintained list: what codex-cli 0.158.0 and Claude Code 2.1.287 report, recommended model first.
 * The picker shows it until the agents report their own lists (agent:models), and for an agent whose
 * CLI is missing, too old or couldn't be asked.
 */
export const MODEL_CATALOG: ModelOption[] = [
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "Frontier intelligence for the most demanding work", recommended: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "Previous generation workhorse model" },
  { id: "gpt-6-luna", name: "GPT-6-Luna", provider: "codex", description: "Fast and affordable model for easier tasks" },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", provider: "codex", description: "Older generation workhorse model" },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", provider: "codex", description: "Older balanced model for straightforward work" },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", provider: "codex", description: "Older fast and efficient model" },
  { id: "gpt-5.5", name: "GPT-5.5", provider: "codex", description: "Legacy coding model" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "For complex work and everyday tasks", recommended: true },
  { id: "claude-fable-5-1", name: "Fable 5.1", provider: "claude", description: "For your toughest challenges" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", provider: "claude", description: "Most efficient for simpler tasks" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", provider: "claude", description: "Fastest for quick answers" },
  { id: "claude-sonnet-5", name: "Sonnet 5", provider: "claude", description: "Efficient for routine tasks" },
  { id: "claude-opus-5", name: "Opus 5", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-fable-5", name: "Fable 5", provider: "claude", description: "Most capable for your hardest and longest-running tasks" },
  { id: "claude-opus-4-8", name: "Opus 4.8", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-7", name: "Opus 4.7", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-6", name: "Opus 4.6", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "claude", description: "Efficient for routine tasks" },
];

/** A model as its agent's CLI reports it (agent:models), with what it accepts. */
export interface ReportedModel extends ModelCapability {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
}

/** Each agent's reported models; null when its CLI is missing, too old, or couldn't be asked. */
export type AgentModels = Record<ModelProvider, ReportedModel[] | null>;
```

- [ ] **Step 2: Write the failing tests**

Create `app/src/lib/models.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModels, ModelOption, ReportedModel } from "../model";
import { capabilitiesFrom, mergeModels, resolveModel } from "./models.ts";

const fallback: ModelOption[] = [
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "Frontier", recommended: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "Workhorse" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "Everyday", recommended: true },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "claude", description: "Routine" },
];
const reported = (id: string, extra: Partial<ReportedModel> = {}): ReportedModel => ({ id, name: id.toUpperCase(), description: `${id} model`, recommended: false, efforts: ["low", "high"], ultracode: false, ...extra });

test("each agent's own list replaces the maintained one, recommended model first", () => {
  const models: AgentModels = { codex: [reported("gpt-5.5"), reported("gpt-6.1-sol", { recommended: true })], claude: null };
  assert.deepEqual(mergeModels(models, fallback), [
    { id: "gpt-6.1-sol", name: "GPT-6.1-SOL", provider: "codex", description: "gpt-6.1-sol model", recommended: true },
    { id: "gpt-5.5", name: "GPT-5.5", provider: "codex", description: "gpt-5.5 model" },
    fallback[2],
    fallback[3],
  ]);
});

test("the maintained list stands in while nothing is reported, or for an empty list", () => {
  assert.deepEqual(mergeModels(null, fallback), fallback);
  assert.deepEqual(mergeModels({ codex: [], claude: null }, fallback), fallback);
});

test("capabilities come from the reported models", () => {
  const models: AgentModels = { codex: [reported("gpt-6-sol", { efforts: ["low", "ultra"], defaultEffort: "medium" })], claude: [reported("claude-opus-5-5", { efforts: ["low", "xhigh"], ultracode: true })] };
  assert.deepEqual(capabilitiesFrom(models), {
    codex: { "gpt-6-sol": { efforts: ["low", "ultra"], defaultEffort: "medium", ultracode: false } },
    claude: { "claude-opus-5-5": { efforts: ["low", "xhigh"], ultracode: true } },
  });
  assert.deepEqual(capabilitiesFrom({ codex: null, claude: null }), { codex: {}, claude: {} });
  assert.equal(capabilitiesFrom(null), null);
});

test("a model no longer offered gives way to its provider's recommended one", () => {
  assert.equal(resolveModel(fallback, "gpt-6-sol", "codex").id, "gpt-6-sol");
  assert.equal(resolveModel(fallback, "gpt-6.1-sol", "codex").id, "gpt-6-astra");
  assert.equal(resolveModel(fallback, "claude-sonnet-4-5", "claude").id, "claude-opus-5-5");
  assert.equal(resolveModel(fallback.filter((model) => !model.recommended), undefined, "claude").id, "claude-sonnet-4-6");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test app/src/lib/models.test.ts`
Expected: FAIL with `Cannot find module` for `./models.ts`.

- [ ] **Step 4: Implement the merge**

Create `app/src/lib/models.ts`:

```ts
import type { AgentModels, ModelCapabilities, ModelOption, ModelProvider } from "../model";

const PROVIDERS: ModelProvider[] = ["codex", "claude"];

/**
 * The models the picker offers: each agent's own list, its recommended model first, or the maintained
 * list for an agent that hasn't reported one (still loading, CLI missing or too old, lookup failed).
 */
export function mergeModels(reported: AgentModels | null, fallback: ModelOption[]): ModelOption[] {
  return PROVIDERS.flatMap((provider) => {
    const list = reported?.[provider];
    if (!list?.length) return fallback.filter((model) => model.provider === provider);
    const options: ModelOption[] = list.map(({ id, name, description, recommended }) => ({ id, name, provider, description, ...(recommended ? { recommended: true } : {}) }));
    return [...options.filter((model) => model.recommended), ...options.filter((model) => !model.recommended)];
  });
}

/** What each reported model accepts, by provider and model id (see capabilityFor). */
export function capabilitiesFrom(reported: AgentModels | null): ModelCapabilities | null {
  if (!reported) return null;
  const byId = (provider: ModelProvider) => Object.fromEntries((reported[provider] ?? []).map(({ id, efforts, defaultEffort, ultracode }) => [id, { efforts, ...(defaultEffort ? { defaultEffort } : {}), ultracode }]));
  return { codex: byId("codex"), claude: byId("claude") };
}

/** `wanted` when the list has it; otherwise the recommended model of `provider`, any model of it, or the first model. */
export function resolveModel(models: ModelOption[], wanted: string | undefined, provider: ModelProvider): ModelOption {
  return models.find((model) => model.id === wanted)
    ?? models.find((model) => model.provider === provider && model.recommended)
    ?? models.find((model) => model.provider === provider)
    ?? models[0];
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node --test app/src/lib/models.test.ts && npm run typecheck`
Expected: PASS, 4 tests. The typecheck is clean (the new types are unused so far).

- [ ] **Step 6: Commit**

```bash
git add app/src/model.ts app/src/lib/models.ts app/src/lib/models.test.ts
git commit -m "feat: merge the agents' model lists with the maintained one" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 7: Wire it up

**Files:**
- Modify: `electron/main.cjs`, `electron/preload.cjs`, `app/src/electron.d.ts`, `app/src/App.tsx`, `app/src/components/ChatComposer.tsx`, `app/src/components/PromptComposer.tsx`, `app/src/components/Settings.tsx`, `app/src/lib/settings.ts`
- Delete: `electron/agents/capabilities.cjs`, `electron/agents/capabilities.test.cjs`

**Interfaces:**
- Consumes: `loadLoginEnvironment` (Task 1), `createCliCache` (Task 3), `createModelCache` (Task 5), and `mergeModels`, `capabilitiesFrom`, `resolveModel`, `AgentModels` (Task 6).
- Produces:
  - IPC `agent:models`. `agent:start-turn` rejects with `cli.problem`.
  - Preload `getModels()`.
  - `ChatComposer`, `PromptComposer` and `SettingsPanel` take a `models: ModelOption[]` prop.

- [ ] **Step 1: Main process**

In `electron/main.cjs`:

1. Replace the two requires `const { createCapabilityCache } = require("./agents/capabilities.cjs");` and `const { resolveExecutable } = require("./agents/environment.cjs");` with:

```js
const { createCliCache } = require("./agents/cli.cjs");
const { loadLoginEnvironment } = require("./agents/environment.cjs");
const { createModelCache } = require("./agents/models.cjs");
```

2. Replace everything from `// CLI paths are looked up once per run; a missing CLI is looked up again next time.` through `ipcMain.handle("agent:capabilities", () => modelCapabilities());` with:

```js
// Opened from Finder or the Dock, the app has launchd's bare PATH. The login shell's environment is read
// once, in the background: windows open without waiting, and the first agent waits for it.
const environmentReady = loadLoginEnvironment().then(({ source }) => {
  if (source === "fallback") console.warn("Milagre couldn't read your login shell's environment; looking for agents in common install folders.");
}, (error) => console.warn("Milagre couldn't read your login shell's environment:", error.message));
// Each CLI is found and its version checked once per run; a missing or outdated one is checked again on the next message.
const agentCli = createCliCache({ ready: () => environmentReady });

ipcMain.handle("agent:start-turn", async (_event, request) => {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const cli = await agentCli(request.provider === "codex" ? "codex" : "claude");
  // The renderer shows a start refused here as the turn's failure.
  if (cli.problem) throw new Error(cli.problem);
  return agents.startTurn({ ...request, prompt, images, command: cli.command });
});

const agentModels = createModelCache({ cli: agentCli, cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
ipcMain.handle("agent:models", () => agentModels());
```

- [ ] **Step 2: Preload and types**

In `electron/preload.cjs`, replace `getModelCapabilities: () => ipcRenderer.invoke("agent:capabilities"),` with:

```js
  getModels: () => ipcRenderer.invoke("agent:models"),
```

In `app/src/electron.d.ts`:

1. In the `./model` import, replace `ModelCapabilities` with `AgentModels`.
2. Replace `getModelCapabilities: () => Promise<ModelCapabilities>;` with:

```ts
      /** Each agent's model list as its CLI reports it, asked once per app run; null for an agent that couldn't be asked. */
      getModels: () => Promise<AgentModels>;
```

- [ ] **Step 3: `App.tsx`**

1. In the `./model` import list, replace `ModelCapabilities,` with `AgentModels,`.
2. Add below `import { chatKey, chatsWaitingForUser, modelForChat, sentDecision, sentReply } from "./lib/agent-runs";`:

```ts
import { capabilitiesFrom, mergeModels, resolveModel } from "./lib/models";
```

3. Replace these three lines:

```ts
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  useEffect(() => { void window.milagre.getModelCapabilities().then(setCapabilities).catch(() => undefined); }, []);
  const selectedCapability = capabilityFor(selectedModel, capabilities);
```

with:

```ts
  // The agents' own model lists; the maintained list stands in until they arrive, and for a missing CLI.
  const [reported, setReported] = useState<AgentModels | null>(null);
  useEffect(() => { void window.milagre.getModels().then(setReported).catch(() => undefined); }, []);
  const models = useMemo(() => mergeModels(reported, MODEL_CATALOG), [reported]);
  const capabilities = useMemo(() => capabilitiesFrom(reported), [reported]);
  // Until the user picks a model, the picker shows the default from Settings once the lists have it. A
  // model the agents don't offer gives way to its provider's recommended model.
  const pickedModel = useRef(false);
  useEffect(() => {
    setSelectedModel((current) => {
      const { defaultModelId } = getSettings();
      const wanted = !pickedModel.current && models.some((model) => model.id === defaultModelId) ? defaultModelId : current.id;
      return resolveModel(models, wanted, current.provider);
    });
  }, [models]);
  const chooseModel = (model: ModelOption) => { pickedModel.current = true; setSelectedModel(model); };
  const selectedCapability = capabilityFor(selectedModel, capabilities);
```

4. In the "A chat stays on the agent it started with" effect and in `executeSend`, replace the last argument of both `modelForChat(…, MODEL_CATALOG)` calls with `models`.
5. Replace `runModelName={run ? MODEL_CATALOG.find((model) => model.id === run.model)?.name ?? run.model : undefined}` with:

```tsx
            runModelName={run ? models.find((model) => model.id === run.model)?.name ?? run.model : undefined}
```

6. Replace `selectedModel={selectedModel}` and `onModelChange={setSelectedModel}` (the `ChatComposer` props) with:

```tsx
            models={models}
            selectedModel={selectedModel}
            onModelChange={chooseModel}
```

7. Replace `{view === "settings" && <SettingsPanel section={settingsSection} />}` with:

```tsx
        {view === "settings" && <SettingsPanel section={settingsSection} models={models} />}
```

`MODEL_CATALOG` stays imported for `mergeModels` and the initial `selectedModel`.

- [ ] **Step 4: `ChatComposer.tsx`**

1. In `interface ChatComposerProps`, replace `selectedModel: ModelOption;` with:

```ts
  /** The models the picker offers (see mergeModels). */
  models: ModelOption[];
  selectedModel: ModelOption;
```

2. In the `ChatComposer({ … })` destructuring, replace `selectedModel,` (the line after `lockedProvider,`) with:

```ts
  models,
  selectedModel,
```

3. In the `<PromptComposer … />` props, replace `selectedModel={selectedModel}` with:

```tsx
          models={models}
          selectedModel={selectedModel}
```

- [ ] **Step 5: `PromptComposer.tsx`**

1. Replace `import { effortCopy, MODEL_CATALOG, PERMISSION_MODES } from "../model";` with:

```ts
import { effortCopy, PERMISSION_MODES } from "../model";
```

2. In `interface PromptComposerProps`, replace `selectedModel: ModelOption;` with:

```ts
  /** The models each agent offers, or the maintained list until it reports them. */
  models: ModelOption[];
  selectedModel: ModelOption;
```

3. In the `PromptComposer({ … })` parameter list, replace `lockedProvider, selectedModel,` with `lockedProvider, models, selectedModel,`.
4. Replace `const modelRows = MODEL_CATALOG.filter(` with `const modelRows = models.filter(`.
5. In the provider tabs, replace `{MODEL_CATALOG.filter((model) => model.provider === item).length}` with `{models.filter((model) => model.provider === item).length}`.

- [ ] **Step 6: Settings**

In `app/src/components/Settings.tsx`:

1. Replace the two `../model` imports with:

```ts
import { PERMISSION_MODES } from "../model";
import type { ModelOption, PermissionMode } from "../model";
```

2. Replace `function GeneralSettings() {` with `function GeneralSettings({ models }: { models: ModelOption[] }) {`.
3. Replace `{MODEL_CATALOG.filter((model) => model.provider === provider).map(` with `{models.filter((model) => model.provider === provider).map(`.
4. Replace `export function SettingsPanel({ section }: { section: SettingsSection }) {` with:

```tsx
export function SettingsPanel({ section, models }: { section: SettingsSection; models: ModelOption[] }) {
```

5. Replace `{section === "general" && <GeneralSettings />}` with `{section === "general" && <GeneralSettings models={models} />}`.

In `app/src/lib/settings.ts`, replace the `defaultModelId: MODEL_CATALOG.some(…) ? saved.defaultModelId! : DEFAULTS.defaultModelId,` line in `load()` with:

```ts
      // Any saved id is kept: the agents report models the maintained list lacks, and App falls back
      // to a provider's recommended model when the saved one isn't offered.
      defaultModelId: typeof saved.defaultModelId === "string" && saved.defaultModelId ? saved.defaultModelId : DEFAULTS.defaultModelId,
```

- [ ] **Step 7: Remove the old capability lookup**

```bash
git rm electron/agents/capabilities.cjs electron/agents/capabilities.test.cjs
```

Its three `claudeCapability` tests moved to `models.test.cjs` in Task 5.

- [ ] **Step 8: Typecheck, test and build**

Run: `npm run typecheck && npm run test:agent && npm run build`
Expected: all clean, with 242 tests passing. `grep -rn "agent:capabilities\|getModelCapabilities\|createCapabilityCache" electron app/src` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add electron/main.cjs electron/preload.cjs app/src
git commit -m "feat: read the agents' environment, CLI checks and model lists in the app" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the requirements**

In `README.md`, replace the line `- At least one supported local CLI agent, such as Codex CLI or Claude Code` with:

```markdown
- At least one local CLI agent, logged in: Claude Code 2.1.286 or newer (`claude auth login`), or Codex CLI 0.158.0 or newer (`codex login`)
```

Below the paragraph `Milagre runs agent commands locally. …`, add:

```markdown
Milagre reads your login shell's environment at startup, so it finds the agents and gives them your `PATH` (`node`, `git`, `gh` and the rest) even when it's opened from Finder or the Dock. The model picker lists the models each installed CLI reports.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: list the supported agent CLI versions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 10: Flag a CLI problem in the model picker

Added after the plan was approved. The turn's own message (Tasks 3 and 4) stays as it is; the picker flags the same problem earlier.

**Files:**
- Create: `electron/agents/status.cjs`, `app/src/lib/cli-status.ts`
- Modify: `electron/main.cjs`, `electron/preload.cjs`, `app/src/electron.d.ts`, `app/src/model.ts`, `app/src/App.tsx`, `app/src/components/ChatComposer.tsx`, `app/src/components/PromptComposer.tsx`
- Test: `electron/agents/status.test.cjs`, `app/src/lib/cli-status.test.ts`

**Interfaces:**
- Consumes: `createCliCache` (Task 3), `loginMessage` (Task 2), `CodexRpc`.
- Produces:
  - IPC `agent:cli-status` → `{ claude: CliStatus, codex: CliStatus }`, with `CliStatus = { state: "ready" | "missing" | "outdated" | "logged-out" | "broken", message?: string }`. Preload `getCliStatus()`. `message` is exactly the Global Constraints copy for that case, and absent for `ready`.
  - `createCliStatus({ cli, cwd, clientVersion, now?, ttlMs?, loggedOut? })` in `status.cjs`, with `claudeLoggedOut(command)` and `codexLoggedOut(command, { cwd, clientVersion })`.
  - `cliTabLabel`, `cliNotice`, `messageParts` in `app/src/lib/cli-status.ts`.

**Rules:**
- `missing`, `outdated` and `broken` come from Task 3's check (no command; a command and a version; a command and no version).
- Codex `logged-out`: a short-lived app-server answers `account/read { refreshToken: false }` with `account: null` and `requiresOpenaiAuth: true`. An error, or an app-server that won't start, counts as ready.
- Claude `logged-out`: `claude auth status` (10 s timeout), its JSON read even when the exit code is 1. Recorded with Claude Code 2.1.287: an empty `CLAUDE_CONFIG_DIR` prints `{ "loggedIn": false, "authMethod": "none", … }` and exits 1; the default config prints `"loggedIn": true` and exits 0. Only an explicit `"loggedIn": false` counts. Any other failure or unreadable output is ready.
- Never run login, logout or any other auth-changing command.
- A `ready` status is kept for 5 minutes. A problem is never kept and is checked again on the next call. Everything waits for the login environment (through the CLI check).
- The picker loads the status at startup, next to `agent:models`, and each time it opens. A non-ready provider tab shows "Not installed", "Update", "Log in" or "Not working" in `text-orange` instead of its model count, with `title` set to the message (the locked-provider `title` wins). The open tab shows the full message once above the model rows (`text-[12px] text-ink-2`, `bg-inset`, rounded, backtick spans as `<code>`). The models stay listed and selectable.

- [ ] **Step 1:** Write `status.test.cjs` (each state; the 5-minute cache; a problem checked on every call; `claude auth status` failing in an unexpected way counts as ready; a Codex `account/read` error counts as ready) and `cli-status.test.ts` (the label mapping, the notice, the backtick spans). Run them and watch them fail.
- [ ] **Step 2:** Implement `status.cjs` and `cli-status.ts`; wire `agent:cli-status`, `getCliStatus`, the `CliStatus` types, App's `cliStatus` state with `refreshCliStatus` and `ChatComposer` and `PromptComposer`'s `cliStatus` and `onModelPickerOpen` props.
- [ ] **Step 3:** Run `node --test electron/agents/status.test.cjs app/src/lib/cli-status.test.ts` and `npm run typecheck`. Expected: PASS and clean.
- [ ] **Step 4: Commit** with `feat: flag a missing, outdated or logged-out CLI in the model picker`.

**Also changed on the way (main moved after this plan was written).** `electron/usage.cjs` (PR #31) starts `codex` from the app's `PATH`, so `createUsageReader` takes a `ready` promise and waits for the login environment before reading either provider; `main.cjs` passes the same `environmentReady` that the CLI check waits for, and defines it at the top of the file.

---

### Task 9: Verify with the real CLIs

**Files:** none committed. Scripts live in the session scratchpad.

The controller runs this task, not a subagent. Never touch Victor's Milagre (Vite on 5180, his server on 5181, his Electron and profile). Use your own Vite port (for example 5191), `--remote-debugging-port` (for example 9341), a `--user-data-dir` in the scratchpad, and a throwaway git repository as the working directory. Stop only processes you started, by PID.

**The Finder-like launcher.** A real Finder launch gives the app only `COMMAND_MODE`, `HOME`, `LOGNAME`, `MallocNanoZone`, `OSLogRateLimit`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `SHELL`, `SSH_AUTH_SOCK`, `TMPDIR`, `USER`, the `XPC_*` pair and `__CF*`. Recorded in the scratchpad's `probe/env/finder-env.json`.

Write `finder-launch.cjs` in the scratchpad. It spawns this branch's `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <worktree> --user-data-dir=<scratch> --remote-debugging-port=<port>`, with `cwd` set to the throwaway repository. Its env is exactly:

```js
{ HOME, USER, LOGNAME: USER, SHELL: "/bin/zsh", TMPDIR, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", MILAGRE_DEV_SERVER_URL: "http://127.0.0.1:5191", ...overrides }
```

`overrides` come from a JSON argument. Drive the window with Playwright over CDP. Use `claude-haiku-4-5` and `gpt-6-sol`, and Full permission so no approvals interrupt. Every check below must pass, with no page errors. Victor follows from his phone, so send each step's screenshots with `SendUserFile` as soon as they exist, including failures.

- [ ] **Step 1: A Finder-like launch finds both CLIs and gives agents the shell's PATH**
  - Launch with no overrides.
  - In a new Claude chat, ask: "Run `command -v node gh git` and reply with exactly its output."
  - Expected: three absolute paths, with `node` under `~/.nvm/versions/node/` and `gh` under `/opt/homebrew/bin`.
  - Repeat in a new Codex chat. Expected: a reply with the same three paths, not "Milagre couldn't find Codex".
- [ ] **Step 2: A logged-out temporary home shows the login message**
  - Relaunch with `{ "CLAUDE_CONFIG_DIR": "<scratch>/empty-claude", "CODEX_HOME": "<scratch>/empty-codex" }`, both empty folders. The app's own variables win over the shell's, so these stick.
  - New Claude chat, "hi". Expected within 2 s: "Agent error: Claude Code isn't logged in. Run `claude auth login` in a terminal, then send your message again."
  - New Codex chat, "hi". Expected within 3 s (not about 15 s): "Agent error: Codex isn't logged in. Run `codex login` in a terminal, then send your message again."
  - Victor's `~/.claude` and `~/.codex` are untouched: `claude auth status` still says `"loggedIn": true`.
- [ ] **Step 3: A too-old fake binary shows the update message, and updating needs no restart**
  - In `<scratch>/fake-bin/`, write an executable `claude`:

    ```sh
    #!/bin/sh
    if [ "$1" = "--version" ]; then echo "2.1.200 (Claude Code)"; exit 0; fi
    exec /Users/victor/.local/bin/claude "$@"
    ```

  - Relaunch with `{ "SHELL": "/bin/tcsh", "PATH": "<scratch>/fake-bin:/usr/bin:/bin:/usr/sbin:/sbin" }`. tcsh is not a supported shell, so there is no import, and the fake comes first.
  - New Claude chat, "hi". Expected: "Agent error: Milagre needs Claude Code 2.1.286 or later, and you have 2.1.200. Run `claude update` in a terminal, then send your message again."
  - Without restarting, change the script's version to `2.1.287` and send "hi" again. Expected: a normal reply.
- [ ] **Step 4: A killed agent recovers**
  - Launch with no overrides.
  - In a Claude chat, send: "Remember the codeword PAPAYA. Then write the numbers from 1 to 400, one per line, and nothing else."
  - While it streams, find the Claude Code process that this Electron's main process started (`pgrep -P <main pid>`, then check the command is the claude binary), and `kill -9` that PID.
  - Expected: the partial reply, then "Agent error: Claude Code stopped unexpectedly: Claude Code process terminated by signal SIGKILL. Send your message again to continue this chat."
  - Send: "What codeword did I ask you to remember? Reply with just the word." Expected: `PAPAYA`.
  - Repeat in a Codex chat, killing the `codex app-server` child. Expected: "Agent error: Codex stopped unexpectedly: Codex exited with code null (SIGKILL). Send your message again to continue this chat.", then `PAPAYA`.
- [ ] **Step 5: The picker lists the reported models**
  - Open the model picker.
  - Codex tab: count 7, in order GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, GPT-5.6-Sol, GPT-5.6-Terra, GPT-5.6-Luna, GPT-5.5. No GPT-6.1 Sol.
  - Claude tab: count 11, starting with Opus 5.5 and including Fable 5.1, with no Sonnet 4.5.
  - Settings → General → Default model lists the same models.
  - An old default model gives way. Through CDP, run `localStorage.setItem("milagre-settings", JSON.stringify({ theme: "light", defaultModelId: "gpt-6.1-sol", defaultPermissionMode: "full" }))` and reload. `gpt-6.1-sol` was the default before this branch, and codex-cli 0.158.0 rejects it.
    - Expected: the composer shows GPT-6-Astra, and a new Codex chat's "hi" gets a reply, not "The 'gpt-6.1-sol' model is not supported…".
- [ ] **Step 5b: The picker flags a logged-out CLI (Task 10)**
  - Relaunch like a Finder launch with `{ "CODEX_HOME": "<scratch>/empty-codex" }`, an empty folder. Open the model picker.
  - Expected: the Codex tab reads "Log in" in orange instead of its count, and the notice "Codex isn't logged in. Run `codex login` in a terminal, then send your message again." sits above the models, which stay listed. The Claude tab still shows its count.
- [ ] **Step 6: A missing CLI**
  - Relaunch with `{ "SHELL": "/bin/tcsh", "HOME": "<scratch>/empty-home" }`. No import, and no install folders under that home.
  - Codex chat, "hi". Expected: "Agent error: Milagre couldn't find Codex. Install it with `npm install -g @openai/codex`, then send your message again." Claude gives its missing message too, unless `/opt/homebrew/bin` or `/usr/local/bin` has one.
  - The picker still lists the maintained models.
- [ ] **Step 7: Nothing else changed**
  - With no overrides, in Ask mode, ask Claude to create `hello.txt` containing hi. Expected: the approval card as before. Allow it, and the turn ends normally.
  - A Codex turn in Ask mode with a command approval works as before.
- [ ] **Step 8: Record the results** in the pull request's "How was it verified?" section, with screenshots of each message (Steps 2, 3, 4 and 6) and of the picker's two tabs.
