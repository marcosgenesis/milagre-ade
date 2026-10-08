# Main Branch Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before Milagre creates a new Worktree, fast-forward the Project's main branch (and its clean checkout) from the remote, controlled by a global default plus a per-Project override, with the last result shown in Project settings on desktop and mobile.

**Architecture:** A new core module `main-sync.cjs` does the git work and never throws. `project-settings.cjs` stores the global default, the per-Project override and the last result. The runtime exposes four `main-sync:*` commands, runs the sync inside `worktree:create`, and emits `main-sync:status`. Shared copy and status formatting live in `@milagre/shared/main-sync`, used by the desktop Settings screen and the mobile settings screens.

**Tech Stack:** Node (CommonJS) core and daemon, `node:test`, React + Tailwind desktop renderer in Electron, Expo / React Native mobile app, TypeScript shared package.

**Spec:** `docs/superpowers/specs/2026-10-08-main-branch-sync-design.md`

## Global Constraints

- All git runs through `createGit()` from `packages/core/src/git/client.cjs` (ADR-0004). `fetch`, `update-ref` and `merge` use `client.write`; everything else uses `client.read`.
- The fetch uses the `NETWORK` profile (30 s timeout).
- `syncMainBranch` never throws and never merges, rebases or stashes. `worktree:create` never fails because of a sync.
- The global default is `false` (off).
- Settings live daemon-side in `<dataDir>/project-settings.json`, never in renderer `localStorage`.
- Copy: global switch "Sync main branch before new Worktrees", hint "Fast-forwards main from its remote. Skipped when main has local changes or commits.", per-Project choices "Use default (On|Off)", "On", "Off".
- Status lines: `updated` "Synced main 3 min ago (a1b2c3d)", `up-to-date` "main was up to date 3 min ago", `skipped` "Skipped 3 min ago: <message>", `failed` "Couldn't sync 3 min ago: <message>", none "Not synced yet".
- Desktop and mobile change in the same PR (AGENTS.md). Mobile changes are JS only: no new dependency, no `app.json` change, so they ship over the air.
- Desktop UI rules (`docs/agents/ui.md`): dropdowns use `primitives/Select`.
- Before the PR: `npm run typecheck`, `npm run typecheck:mobile`, `npm run lint`, `npm test -- --unit`, `npm test -- --only main-sync-settings`.
- Commits and the PR carry no Claude attribution of any kind.

## Review Focus

1. **A detached Worktree whose folder is named `main`.** It must not be mistaken for the checkout of `main`. The plan reads `%(worktreepath)` from `for-each-ref` instead of `worktree list` names. Pinned in Task 1, test "a detached worktree named like main is not mistaken for its checkout".
2. **Main checked out in a linked Worktree, not the main checkout.** That Worktree's files must update, with a skipped message naming its folder when dirty. Pinned in Task 1, test "main checked out in another worktree updates that worktree".
3. **Two new Worktrees requested at once.** Only one sync runs and both requests wait for it. Pinned in Task 3, test "two worktree:create calls share one sync".
4. **A settings file with only `defaults`, or `defaults` of the wrong type.** It must read as sync off and not lose Project entries. Pinned in Task 2, test "damaged defaults read as off and keep Project entries".
5. **Remote is slow or gone.** Worktree creation still succeeds and the status reads "Couldn't sync". Pinned in Task 3's runtime test (remote removed).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/main-sync.cjs` (new) | `syncMainBranch(projectPath, { client, now })`: the git steps, returns a `MainSyncResult` |
| `packages/core/src/main-sync.test.cjs` (new) | Real-git tests against a temp remote and clone |
| `packages/core/src/project-settings.cjs` | Adds `defaults.syncMain`, per-Project `syncMain` and `mainSync`, four methods |
| `packages/core/src/project-settings.test.cjs` | Precedence and persistence tests |
| `packages/core/src/runtime.cjs` | `main-sync:*` commands, per-Project sync lock, hook in `worktree:create`, `main-sync:status` event |
| `packages/core/src/runtime.test.cjs` | End-to-end through `worktree:create` |
| `apps/daemon/src/mobile-bridge.cjs`, `apps/daemon/src/confine.cjs` | Phone may call the four commands |
| `packages/shared/src/main-sync.ts` (new) + `.test.ts` | Types, choice mapping, status line copy |
| `packages/shared/package.json` | Export `./main-sync` |
| `apps/desktop/electron/preload.cjs`, `apps/desktop/app/src/electron.d.ts` | Renderer API |
| `apps/desktop/app/src/components/Settings.tsx` | `MainSyncDefaultSetting` in General, `MainSyncSetting` in Project settings |
| `scripts/test-main-sync-settings.cjs` (new) | Electron check for both controls |
| `apps/mobile/src/app/settings.tsx`, `apps/mobile/src/app/project-settings.tsx` | Mobile controls |
| `GLOSSARY.md` | "Main branch" term |

---

### Task 1: Core sync module

**Files:**
- Create: `packages/core/src/main-sync.cjs`
- Test: `packages/core/src/main-sync.test.cjs`

**Interfaces:**
- Consumes: `createGit()` from `./git/client.cjs`: `client.read.resolveBase(cwd)` returns `{ name, ref }`, `client.read.commitOf(cwd, ref)` returns a SHA or `null`, `client.read.out(cwd, args)` returns trimmed stdout or `null`, `client.read.run(cwd, args)` and `client.write.run(cwd, args, { profile })` return `{ ok, stdout, stderr, message, timedOut }`.
- Produces: `syncMainBranch(projectPath: string, options?: { client?, now?: () => number }): Promise<MainSyncResult>` where `MainSyncResult = { at: number, outcome: "updated" | "up-to-date" | "skipped" | "failed", branch: string, commit?: string, message?: string }`. `commit` is a 7-character SHA.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/main-sync.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { syncMainBranch } = require("./main-sync.cjs");

const ID = ["-c", "user.name=Milagre", "-c", "user.email=milagre@example.com"];
const gitIn = (dir) => (...args) => execFileSync("git", ["-C", dir, ...ID, ...args], { encoding: "utf8" }).trim();
const exists = (file) => fs.access(file).then(() => true, () => false);

// A clone whose main is one commit behind its remote. With `onWork`, the clone has another branch checked out.
async function fixture(t, { onWork = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-main-sync-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote");
  await fs.mkdir(remote);
  const remoteGit = gitIn(remote);
  remoteGit("init", "-q", "-b", "main");
  await fs.writeFile(path.join(remote, "README.md"), "shop\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "init");
  const project = path.join(root, "project");
  execFileSync("git", ["clone", "--quiet", remote, project]);
  const git = gitIn(project);
  if (onWork) git("switch", "-q", "-c", "work");
  await fs.writeFile(path.join(remote, "NEWS.md"), "shipped\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "ship");
  return { root, remote, project, git, behind: git("rev-parse", "main"), ahead: remoteGit("rev-parse", "main") };
}

test("main that isn't checked out anywhere fast-forwards without touching the checkout", async (t) => {
  const { project, git, ahead } = await fixture(t, { onWork: true });
  const result = await syncMainBranch(project, { now: () => 42 });
  assert.deepEqual(result, { at: 42, outcome: "updated", branch: "main", commit: ahead.slice(0, 7) });
  assert.equal(git("rev-parse", "main"), ahead);
  assert.equal(git("branch", "--show-current"), "work");
  assert.equal(await exists(path.join(project, "NEWS.md")), false);
});

test("a clean main checkout fast-forwards its files", async (t) => {
  const { project, git, ahead } = await fixture(t);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(git("rev-parse", "HEAD"), ahead);
  assert.equal(await fs.readFile(path.join(project, "NEWS.md"), "utf8"), "shipped\n");
});

test("a second sync reports up to date", async (t) => {
  const { project, ahead } = await fixture(t);
  await syncMainBranch(project);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "up-to-date");
  assert.equal(result.commit, ahead.slice(0, 7));
});

test("main with commits of its own is skipped and left alone", async (t) => {
  const { project, git } = await fixture(t);
  await fs.writeFile(path.join(project, "LOCAL.md"), "mine\n");
  git("add", ".");
  git("commit", "-qm", "local");
  const before = git("rev-parse", "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.match(result.message, /main has commits that aren't on origin/);
  assert.equal(git("rev-parse", "main"), before);
});

test("a main checkout with uncommitted changes is skipped", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "The main checkout has uncommitted changes");
  assert.equal(git("rev-parse", "main"), behind);
  assert.equal(await fs.readFile(path.join(project, "README.md"), "utf8"), "edited\n");
});

test("a main checkout in the middle of a merge is skipped", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, ".git", "MERGE_HEAD"), `${behind}\n`);
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "The main checkout is in the middle of a merge");
  assert.equal(git("rev-parse", "main"), behind);
});

test("an unreachable remote fails without changing anything", async (t) => {
  const { project, remote, git, behind } = await fixture(t);
  await fs.rm(remote, { recursive: true, force: true });
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "failed");
  assert.equal(result.message, "Could not reach origin");
  assert.equal(git("rev-parse", "main"), behind);
});

test("main without an upstream is skipped", async (t) => {
  const { project, git } = await fixture(t);
  git("branch", "--unset-upstream", "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "main has no remote branch");
});

test("an untracked file in the way is skipped with git's reason", async (t) => {
  const { project, git, behind } = await fixture(t);
  await fs.writeFile(path.join(project, "NEWS.md"), "my draft\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.match(result.message, /would be overwritten/);
  assert.equal(git("rev-parse", "main"), behind);
  assert.equal(await fs.readFile(path.join(project, "NEWS.md"), "utf8"), "my draft\n");
});

test("main checked out in another worktree updates that worktree", async (t) => {
  const { root, project, git, ahead } = await fixture(t, { onWork: true });
  const other = path.join(root, "other");
  git("worktree", "add", "-q", other, "main");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(await fs.readFile(path.join(other, "NEWS.md"), "utf8"), "shipped\n");
  assert.equal(git("rev-parse", "main"), ahead);
});

test("a dirty other worktree is named in the skip message", async (t) => {
  const { root, project, git } = await fixture(t, { onWork: true });
  const other = path.join(root, "other");
  git("worktree", "add", "-q", other, "main");
  await fs.writeFile(path.join(other, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "other has uncommitted changes on main");
});

test("a detached worktree named like main is not mistaken for its checkout", async (t) => {
  const { root, project, git, behind, ahead } = await fixture(t, { onWork: true });
  const decoy = path.join(root, "main");
  git("worktree", "add", "-q", "--detach", decoy, behind);
  await fs.writeFile(path.join(decoy, "README.md"), "edited\n");
  const result = await syncMainBranch(project);
  assert.equal(result.outcome, "updated");
  assert.equal(git("rev-parse", "main"), ahead);
});

test("a folder that isn't a repository resolves instead of throwing", async (t) => {
  const { root } = await fixture(t);
  const result = await syncMainBranch(root);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.message, "No local main branch");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/core/src/main-sync.test.cjs`
Expected: FAIL with `Cannot find module './main-sync.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/main-sync.cjs`:

```js
const fs = require("node:fs/promises");
const path = require("node:path");
const { createGit } = require("./git/client.cjs");

// Brings a Project's main branch up to its remote before a new Worktree is made (see
// docs/superpowers/specs/2026-10-08-main-branch-sync-design.md). Only ever a fast-forward: a branch with
// commits of its own, a dirty checkout or one mid-merge is left alone and the reason comes back.

// Files in a checkout's git dir that mean an operation is half done.
const IN_PROGRESS = [
  ["MERGE_HEAD", "merge"],
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

const short = (commit) => commit.slice(0, 7);
const firstLine = (text) =>
  String(text ?? "")
    .trim()
    .split("\n")[0]
    .replace(/^(error|fatal): /, "");

function fetchFailure(remote, result) {
  if (result.timedOut || /could not resolve host|could not read from remote|unable to access|connection|does not appear to be a git repository/i.test(result.message))
    return `Could not reach ${remote}`;
  return firstLine(result.message) || `Could not fetch from ${remote}`;
}

async function operationInProgress(client, checkout) {
  const gitDir = await client.read.out(checkout, ["rev-parse", "--absolute-git-dir"]);
  if (!gitDir) return null;
  for (const [file, name] of IN_PROGRESS) {
    if (
      await fs.access(path.join(gitDir, file)).then(
        () => true,
        () => false,
      )
    )
      return name;
  }
  return null;
}

async function syncMainBranch(projectPath, { client = createGit(), now = Date.now } = {}) {
  let branch = "main";
  const result = (outcome, extra = {}) => ({ at: now(), outcome, branch, ...extra });
  try {
    branch = (await client.read.resolveBase(projectPath)).name;
    const local = `refs/heads/${branch}`;
    const before = await client.read.commitOf(projectPath, local);
    if (!before) return result("skipped", { message: `No local ${branch} branch` });
    const upstream = await client.read.out(projectPath, [
      "for-each-ref",
      "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short)",
      local,
    ]);
    const [remote, remoteRef, tracking] = (upstream ?? "").split("\0");
    // "." is an upstream that is itself a local branch: there is no remote to follow.
    if (!remote || remote === "." || !remoteRef || !tracking) return result("skipped", { message: `${branch} has no remote branch` });
    const fetched = await client.write.run(projectPath, ["fetch", "--quiet", remote, `+${remoteRef}:refs/remotes/${tracking}`], { profile: "NETWORK" });
    if (!fetched.ok) return result("failed", { message: fetchFailure(remote, fetched) });
    const after = await client.read.commitOf(projectPath, `refs/remotes/${tracking}`);
    if (!after) return result("failed", { message: `Could not read ${tracking}` });
    if (after === before) return result("up-to-date", { commit: short(before) });
    const behind = await client.read.run(projectPath, ["merge-base", "--is-ancestor", "--end-of-options", before, after]);
    if (!behind.ok) return result("skipped", { message: `${branch} has commits that aren't on ${remote}`, commit: short(before) });

    // Which Worktree has the branch checked out, if any. A detached Worktree never matches, whatever its folder is called.
    const checkout = await client.read.out(projectPath, ["for-each-ref", "--format=%(worktreepath)", local]);
    if (!checkout) {
      // The old value makes this a compare-and-swap: a commit that lands in between makes it fail.
      const moved = await client.write.run(projectPath, ["update-ref", "-m", "milagre: sync main branch", local, after, before]);
      if (!moved.ok) return result("skipped", { message: `${branch} moved during sync`, commit: short(before) });
      return result("updated", { commit: short(after) });
    }
    const where = path.resolve(checkout) === path.resolve(projectPath) ? "The main checkout" : path.basename(checkout);
    const busy = await operationInProgress(client, checkout);
    if (busy) return result("skipped", { message: `${where} is in the middle of a ${busy}`, commit: short(before) });
    const status = await client.read.run(checkout, ["status", "--porcelain=v1", "--untracked-files=no"]);
    if (!status.ok) return result("failed", { message: firstLine(status.message) || `Could not read ${where}` });
    if (status.stdout.trim()) {
      const message = where === "The main checkout" ? "The main checkout has uncommitted changes" : `${where} has uncommitted changes on ${branch}`;
      return result("skipped", { message, commit: short(before) });
    }
    const merged = await client.write.run(checkout, ["merge", "--ff-only", "--quiet", after]);
    if (!merged.ok) return result("skipped", { message: firstLine(merged.message) || `Could not fast-forward ${branch}`, commit: short(before) });
    return result("updated", { commit: short(after) });
  } catch (error) {
    return result("failed", { message: firstLine(error?.message) || "Sync failed" });
  }
}

module.exports = { syncMainBranch };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/core/src/main-sync.test.cjs`
Expected: all 13 tests PASS. If "an unreachable remote" fails on the message, print `fetched.message` once and widen the regex in `fetchFailure` to match it; keep the test's expected copy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/main-sync.cjs packages/core/src/main-sync.test.cjs
git commit -m "feat: fast-forward a Project's main branch from its remote"
```

---

### Task 2: Settings storage

**Files:**
- Modify: `packages/core/src/project-settings.cjs`
- Test: `packages/core/src/project-settings.test.cjs`

**Interfaces:**
- Consumes: `MainSyncResult` shape from Task 1.
- Produces, on the object `createProjectSettings(file)` returns:
  - `getMainSync(projectPath): Promise<{ override: boolean | null, defaultValue: boolean, enabled: boolean, last: MainSyncResult | null }>`
  - `setMainSyncOverride(projectPath, value: boolean | null): Promise<same as getMainSync>`
  - `getMainSyncDefault(): Promise<{ syncMain: boolean }>`
  - `setMainSyncDefault(value: boolean): Promise<{ syncMain: boolean }>`
  - `recordMainSync(projectPath, result: MainSyncResult): Promise<void>`
  - `get()` is unchanged (still returns only `filesToCopy`, `setupCommand`, `icon`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/project-settings.test.cjs`:

```js
test("main sync follows the global default until a Project overrides it", async (t) => {
  const { settings } = await store(t);
  assert.deepEqual(await settings.getMainSync("/work/shop"), { override: null, defaultValue: false, enabled: false, last: null });
  assert.deepEqual(await settings.setMainSyncDefault(true), { syncMain: true });
  assert.equal((await settings.getMainSync("/work/shop")).enabled, true);
  assert.deepEqual(await settings.setMainSyncOverride("/work/shop", false), { override: false, defaultValue: true, enabled: false, last: null });
  await settings.setMainSyncOverride("/work/shop", null);
  assert.deepEqual(await settings.getMainSync("/work/shop"), { override: null, defaultValue: true, enabled: true, last: null });
});

test("the global default survives per-Project saves and a restart", async (t) => {
  const { file, settings } = await store(t);
  await settings.setMainSyncDefault(true);
  await settings.setFilesToCopy("/work/shop", [".env"]);
  const reopened = createProjectSettings(file);
  assert.deepEqual(await reopened.getMainSyncDefault(), { syncMain: true });
  assert.deepEqual(await reopened.get("/work/shop"), { filesToCopy: [".env"], setupCommand: "", icon: null });
});

test("clearing an override leaves no empty Project entry", async (t) => {
  const { file, settings } = await store(t);
  await settings.setMainSyncOverride("/work/shop", true);
  await settings.setMainSyncOverride("/work/shop", null);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).projects, {});
});

test("the last sync result is kept per Project, and a damaged one reads as none", async (t) => {
  const { file, settings } = await store(t);
  const last = { at: 1760000000000, outcome: "updated", branch: "main", commit: "a1b2c3d" };
  await settings.recordMainSync("/work/shop", last);
  assert.deepEqual((await settings.getMainSync("/work/shop")).last, last);
  assert.equal((await settings.getMainSync("/work/blog")).last, null);
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.projects[path.resolve("/work/shop")].mainSync = { outcome: "exploded" };
  await fs.writeFile(file, JSON.stringify(data));
  assert.equal((await settings.getMainSync("/work/shop")).last, null);
});

test("damaged defaults read as off and keep Project entries", async (t) => {
  const { file, settings } = await store(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ defaults: "yes", projects: { [path.resolve("/work/shop")]: { setupCommand: "npm i" } } }));
  assert.deepEqual(await settings.getMainSyncDefault(), { syncMain: false });
  await settings.setMainSyncDefault(true);
  assert.deepEqual(await settings.get("/work/shop"), { filesToCopy: [], setupCommand: "npm i", icon: null });
  assert.deepEqual(await settings.getMainSyncDefault(), { syncMain: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/core/src/project-settings.test.cjs`
Expected: FAIL with `settings.getMainSync is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/project-settings.cjs`, add after `normalizeIcon`:

```js
const SYNC_OUTCOMES = new Set(["updated", "up-to-date", "skipped", "failed"]);
// The last main branch sync (see main-sync.cjs). Anything that doesn't look like one reads as none.
function normalizeMainSync(value) {
  if (!value || typeof value !== "object" || !Number.isFinite(value.at) || !SYNC_OUTCOMES.has(value.outcome) || typeof value.branch !== "string")
    return null;
  return {
    at: value.at,
    outcome: value.outcome,
    branch: value.branch,
    ...(typeof value.commit === "string" ? { commit: value.commit } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}
```

Replace the body of `update(projectPath, change)` with a file-level `save(change)` and an `update` built on it:

```js
  // Saves run one at a time. `change` edits the whole file's data.
  function save(change) {
    const next = queue
      .catch(() => {})
      .then(async () => {
        const data = await read({ strict: true });
        change(data);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(data, null, 2));
        await fs.rename(temporary, file);
      });
    queue = next;
    return next;
  }

  // `change` edits the project's entry; an entry left empty is removed.
  function update(projectPath, change) {
    return save((data) => {
      const key = path.resolve(projectPath);
      const entry = { ...data.projects[key] };
      change(entry);
      if (Object.keys(entry).length > 0) data.projects[key] = entry;
      else delete data.projects[key];
    });
  }

  async function readMainSync(projectPath) {
    const data = await read({ strict: false });
    const entry = data.projects[path.resolve(projectPath)] ?? {};
    const override = typeof entry.syncMain === "boolean" ? entry.syncMain : null;
    const defaultValue = data.defaults?.syncMain === true;
    return { override, defaultValue, enabled: override ?? defaultValue, last: normalizeMainSync(entry.mainSync) };
  }
```

Add to the returned object:

```js
    // Whether new Worktrees sync main first: the Project's own choice, else the global default (off).
    getMainSync: readMainSync,
    // null removes the Project's choice, which brings the global default back.
    async setMainSyncOverride(projectPath, value) {
      await update(projectPath, (entry) => {
        if (typeof value === "boolean") entry.syncMain = value;
        else delete entry.syncMain;
      });
      return readMainSync(projectPath);
    },
    async getMainSyncDefault() {
      const data = await read({ strict: false });
      return { syncMain: data.defaults?.syncMain === true };
    },
    async setMainSyncDefault(value) {
      await save((data) => {
        const defaults = data.defaults && typeof data.defaults === "object" ? data.defaults : {};
        data.defaults = { ...defaults, syncMain: value === true };
      });
      return { syncMain: value === true };
    },
    async recordMainSync(projectPath, result) {
      const value = normalizeMainSync(result);
      await update(projectPath, (entry) => {
        if (value) entry.mainSync = value;
        else delete entry.mainSync;
      });
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/core/src/project-settings.test.cjs`
Expected: every test PASS, old ones included.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project-settings.cjs packages/core/src/project-settings.test.cjs
git commit -m "feat: store the main branch sync default, override and last result"
```

---

### Task 3: Runtime commands, the `worktree:create` hook, phone access, glossary

**Files:**
- Modify: `packages/core/src/runtime.cjs` (near the `worktree-setup:*` handlers around line 514, and `worktree:create` around line 542)
- Modify: `apps/daemon/src/mobile-bridge.cjs` (`METHODS`, line 22)
- Modify: `apps/daemon/src/confine.cjs` (`PATHS`, near `"project:set-hidden"` at line 81)
- Modify: `GLOSSARY.md` (`### Work`, after **Worktree**)
- Test: `packages/core/src/runtime.test.cjs`

**Interfaces:**
- Consumes: `syncMainBranch` (Task 1); `getMainSync`, `setMainSyncOverride`, `getMainSyncDefault`, `setMainSyncDefault`, `recordMainSync` (Task 2); the runtime's existing `git` (`createGit().read`, `runtime.cjs:59`), `emit`, `knownFolder`, `projectSettings()`.
- Produces daemon commands:
  - `main-sync:read(projectPath)` → `MainSyncSettings = { branch: string, override: boolean | null, defaultValue: boolean, enabled: boolean, last: MainSyncResult | null }`
  - `main-sync:save(projectPath, override: boolean | null)` → `MainSyncSettings`
  - `main-sync:default:read()` → `{ syncMain: boolean }`
  - `main-sync:default:save(value: boolean)` → `{ syncMain: boolean }`
  - event `main-sync:status` with `{ projectPath: string, last: MainSyncResult }`

- [ ] **Step 1: Write the failing runtime tests**

Append to `packages/core/src/runtime.test.cjs`:

```js
// A clone of a remote that has moved on: the clone's main is one commit behind.
async function trailingClone(project) {
  const root = path.dirname(project);
  const id = ["-c", "user.name=Milagre", "-c", "user.email=milagre@example.com"];
  const remote = path.join(root, "remote");
  const clone = path.join(root, "clone");
  await fs.mkdir(remote);
  const remoteGit = (...args) => execFileSync("git", ["-C", remote, ...id, ...args], { encoding: "utf8" }).trim();
  remoteGit("init", "-q", "-b", "main");
  await fs.writeFile(path.join(remote, "README.md"), "shop\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "init");
  execFileSync("git", ["clone", "--quiet", remote, clone]);
  await fs.writeFile(path.join(remote, "NEWS.md"), "shipped\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "ship");
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();
  return { remote, clone, git, behind: git("rev-parse", "main"), ahead: remoteGit("rev-parse", "main") };
}

test("worktree:create syncs main first only when main sync is on, and survives a failed sync", async (t) => {
  const { project, events, make } = await fixture(t);
  const { remote, clone, git, behind, ahead } = await trailingClone(project);
  const worktreeRoot = path.join(path.dirname(project), "worktrees");
  const runtime = make({ cwd: clone, worktreeRoot });
  await runtime.openProject(clone);
  const create = () => runtime.invoke("worktree:create", [{ projectPath: clone, baseBranch: "main", prompt: "" }]);

  assert.deepEqual(await runtime.invoke("main-sync:read", [clone]), { branch: "main", override: null, defaultValue: false, enabled: false, last: null });
  await create();
  assert.equal(git("rev-parse", "main"), behind, "Off by default: main stays where it was");
  assert.equal(events.some(({ channel }) => channel === "main-sync:status"), false);

  assert.deepEqual(await runtime.invoke("main-sync:default:save", [true]), { syncMain: true });
  assert.deepEqual(await runtime.invoke("main-sync:default:read"), { syncMain: true });
  await create();
  assert.equal(git("rev-parse", "main"), ahead);
  assert.equal(await fs.readFile(path.join(clone, "NEWS.md"), "utf8"), "shipped\n");
  const status = events.find(({ channel }) => channel === "main-sync:status");
  assert.deepEqual({ ...status.payload, last: { ...status.payload.last, at: 0 } }, {
    projectPath: clone,
    last: { at: 0, outcome: "updated", branch: "main", commit: ahead.slice(0, 7) },
  });
  assert.equal((await runtime.invoke("main-sync:read", [clone])).last.outcome, "updated");

  const off = await runtime.invoke("main-sync:save", [clone, false]);
  assert.equal(off.enabled, false);
  assert.equal(off.override, false);
  await runtime.invoke("main-sync:save", [clone, null]);

  await fs.rm(remote, { recursive: true, force: true });
  const created = await create();
  assert.ok(Number.isInteger(created.worktreeId), "A failed sync never blocks the Worktree");
  const last = (await runtime.invoke("main-sync:read", [clone])).last;
  assert.equal(last.outcome, "failed");
  assert.equal(last.message, "Could not reach origin");
});

test("two worktree:create calls share one sync", async (t) => {
  const { project, events, make } = await fixture(t);
  const { clone } = await trailingClone(project);
  const runtime = make({ cwd: clone, worktreeRoot: path.join(path.dirname(project), "worktrees") });
  await runtime.openProject(clone);
  await runtime.invoke("main-sync:save", [clone, true]);
  const create = () => runtime.invoke("worktree:create", [{ projectPath: clone, baseBranch: "main", prompt: "" }]);
  await Promise.all([create(), create()]);
  assert.equal(events.filter(({ channel }) => channel === "main-sync:status").length, 1);
});

test("main-sync commands refuse a folder Milagre hasn't opened", async (t) => {
  const { make } = await fixture(t);
  const runtime = make();
  await assert.rejects(runtime.invoke("main-sync:read", ["/not/opened"]), /Open this project in Milagre first/);
  await assert.rejects(runtime.invoke("main-sync:save", ["/not/opened", true]), /Open this project in Milagre first/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "main sync|share one sync|main-sync" packages/core/src/runtime.test.cjs`
Expected: FAIL with `Unknown command: main-sync:read`.

- [ ] **Step 3: Implement the runtime side**

In `packages/core/src/runtime.cjs`, add the import beside the other core requires:

```js
const { syncMainBranch } = require("./main-sync.cjs");
```

After the `worktree-setup:save` handler, add:

```js
  // Main branch sync (see main-sync.cjs): the setting, and one sync at a time per Project.
  async function readMainSync(projectPath) {
    const [settings, base] = await Promise.all([projectSettings().getMainSync(projectPath), git.resolveBase(projectPath).catch(() => ({ name: "main" }))]);
    return { branch: base.name, ...settings };
  }
  const mainSyncs = new Map();
  function syncMain(projectPath) {
    let running = mainSyncs.get(projectPath);
    if (!running) {
      running = syncMainBranch(projectPath)
        .then(async (last) => {
          await projectSettings()
            .recordMainSync(projectPath, last)
            .catch((error) => console.warn("Milagre main sync:", error.message));
          emit("main-sync:status", { projectPath, last });
          return last;
        })
        .finally(() => mainSyncs.delete(projectPath));
      mainSyncs.set(projectPath, running);
    }
    return running;
  }
  commands.handle("main-sync:read", async (_event, projectPath) => {
    await knownFolder(projectPath);
    await environmentReady;
    return readMainSync(projectPath);
  });
  commands.handle("main-sync:save", async (_event, projectPath, override) => {
    await knownFolder(projectPath);
    await projectSettings().setMainSyncOverride(projectPath, typeof override === "boolean" ? override : null);
    await environmentReady;
    return readMainSync(projectPath);
  });
  commands.handle("main-sync:default:read", () => projectSettings().getMainSyncDefault());
  commands.handle("main-sync:default:save", (_event, value) => projectSettings().setMainSyncDefault(value === true));
```

In the `worktree:create` handler, right after `const settings = await projectSettings().get(projectPath);`, add:

```js
    // Brings main up to its remote first, when the user asked for it. Never throws: a skipped or failed sync
    // leaves main as it was and the Worktree starts from it as before.
    if ((await projectSettings().getMainSync(projectPath)).enabled) await syncMain(projectPath);
```

- [ ] **Step 4: Run the runtime tests**

Run: `node --test packages/core/src/runtime.test.cjs`
Expected: all PASS.

- [ ] **Step 5: Let the phone call the commands**

In `apps/daemon/src/mobile-bridge.cjs`, add to `METHODS` after `"project:set-hidden",`:

```js
  "main-sync:read",
  "main-sync:save",
  "main-sync:default:read",
  "main-sync:default:save",
```

In `apps/daemon/src/confine.cjs`, add after the `"project:set-hidden"` rule:

```js
  "main-sync:read": ([projectPath]) => [projectPath],
  "main-sync:save": ([projectPath]) => [projectPath],
  // The global default names no folder.
  "main-sync:default:read": none,
  "main-sync:default:save": none,
```

Run: `node --test apps/daemon/src/confine.test.cjs apps/daemon/src/mobile-bridge.test.cjs`
Expected: PASS (the "every command the phone may call has a confinement rule" test covers the pairing).

- [ ] **Step 6: Add the glossary term**

In `GLOSSARY.md`, after the **Worktree** entry:

```markdown
**Main branch**:
The branch a **Project**'s remote names as its default (`origin/HEAD`), else `main`, else `master`. Main branch sync fast-forwards it from the remote before a new **Worktree** is made, together with the **Worktree** that has it checked out when that one is clean.
_Avoid_: base (the base is whatever branch a **Worktree** started from, which may not be the main branch)
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime.cjs packages/core/src/runtime.test.cjs apps/daemon/src/mobile-bridge.cjs apps/daemon/src/confine.cjs GLOSSARY.md
git commit -m "feat: sync main before new Worktrees when the Project asks for it"
```

---

### Task 4: Shared copy and types

**Files:**
- Create: `packages/shared/src/main-sync.ts`
- Test: `packages/shared/src/main-sync.test.ts`
- Modify: `packages/shared/package.json` (`files` and `exports`)

**Interfaces:**
- Produces (import path `@milagre/shared/main-sync`):
  - `type MainSyncOutcome = "updated" | "up-to-date" | "skipped" | "failed"`
  - `type MainSyncResult = { at: number; outcome: MainSyncOutcome; branch: string; commit?: string; message?: string }`
  - `type MainSyncSettings = { branch: string; override: boolean | null; defaultValue: boolean; enabled: boolean; last: MainSyncResult | null }`
  - `type MainSyncStatus = { projectPath: string; last: MainSyncResult }`
  - `type MainSyncChoice = "default" | "on" | "off"`
  - `MAIN_SYNC_TITLE = "Sync main branch before new Worktrees"`, `MAIN_SYNC_HINT = "Fast-forwards main from its remote. Skipped when main has local changes or commits."`
  - `mainSyncProjectTitle(branch: string): string` → `"Sync <branch> before new Worktrees"`
  - `choiceOf(override: boolean | null): MainSyncChoice`, `overrideOf(choice: MainSyncChoice): boolean | null`
  - `mainSyncChoices(defaultValue: boolean): { value: MainSyncChoice; title: string }[]`
  - `mainSyncStatusLine(last: MainSyncResult | null, now: number): string`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/main-sync.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { choiceOf, mainSyncChoices, mainSyncProjectTitle, mainSyncStatusLine, overrideOf } from "./main-sync.ts";

const now = 1_760_000_000_000;
const MINUTE = 60_000;

test("status lines name the outcome and how long ago", () => {
  assert.equal(mainSyncStatusLine(null, now), "Not synced yet");
  assert.equal(mainSyncStatusLine({ at: now - 3 * MINUTE, outcome: "updated", branch: "main", commit: "a1b2c3d" }, now), "Synced main 3 min ago (a1b2c3d)");
  assert.equal(mainSyncStatusLine({ at: now - 10_000, outcome: "up-to-date", branch: "trunk", commit: "a1b2c3d" }, now), "trunk was up to date just now");
  assert.equal(
    mainSyncStatusLine({ at: now - 2 * 60 * MINUTE, outcome: "skipped", branch: "main", message: "The main checkout has uncommitted changes" }, now),
    "Skipped 2 h ago: The main checkout has uncommitted changes",
  );
  assert.equal(mainSyncStatusLine({ at: now - 3 * 24 * 60 * MINUTE, outcome: "failed", branch: "main", message: "Could not reach origin" }, now), "Couldn't sync 3 d ago: Could not reach origin");
  assert.equal(mainSyncStatusLine({ at: now + MINUTE, outcome: "updated", branch: "main" }, now), "Synced main just now");
});

test("choices map to the stored override and back", () => {
  assert.equal(choiceOf(null), "default");
  assert.equal(choiceOf(true), "on");
  assert.equal(choiceOf(false), "off");
  assert.equal(overrideOf("default"), null);
  assert.equal(overrideOf("on"), true);
  assert.equal(overrideOf("off"), false);
  assert.deepEqual(
    mainSyncChoices(false).map((choice) => choice.title),
    ["Use default (Off)", "On", "Off"],
  );
  assert.equal(mainSyncChoices(true)[0].title, "Use default (On)");
  assert.equal(mainSyncProjectTitle("trunk"), "Sync trunk before new Worktrees");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/shared/src/main-sync.test.ts`
Expected: FAIL with `Cannot find module` for `./main-sync.ts`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/main-sync.ts`:

```ts
// Main branch sync copy, shared by desktop and phone (see docs/superpowers/specs/2026-10-08-main-branch-sync-design.md).

export type MainSyncOutcome = "updated" | "up-to-date" | "skipped" | "failed";
export type MainSyncResult = { at: number; outcome: MainSyncOutcome; branch: string; commit?: string; message?: string };
export type MainSyncSettings = { branch: string; override: boolean | null; defaultValue: boolean; enabled: boolean; last: MainSyncResult | null };
export type MainSyncStatus = { projectPath: string; last: MainSyncResult };
export type MainSyncChoice = "default" | "on" | "off";

export const MAIN_SYNC_TITLE = "Sync main branch before new Worktrees";
export const MAIN_SYNC_HINT = "Fast-forwards main from its remote. Skipped when main has local changes or commits.";

export function mainSyncProjectTitle(branch: string): string {
  return `Sync ${branch} before new Worktrees`;
}

export function choiceOf(override: boolean | null): MainSyncChoice {
  return override === null ? "default" : override ? "on" : "off";
}

export function overrideOf(choice: MainSyncChoice): boolean | null {
  return choice === "default" ? null : choice === "on";
}

export function mainSyncChoices(defaultValue: boolean): { value: MainSyncChoice; title: string }[] {
  return [
    { value: "default", title: `Use default (${defaultValue ? "On" : "Off"})` },
    { value: "on", title: "On" },
    { value: "off", title: "Off" },
  ];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(at: number, now: number): string {
  const elapsed = now - at;
  // NaN and negative (clock skew) both land here.
  if (!(elapsed >= MINUTE)) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

export function mainSyncStatusLine(last: MainSyncResult | null, now: number): string {
  if (!last) return "Not synced yet";
  const when = ago(last.at, now);
  if (last.outcome === "updated") return `Synced ${last.branch} ${when}${last.commit ? ` (${last.commit})` : ""}`;
  if (last.outcome === "up-to-date") return `${last.branch} was up to date ${when}`;
  if (last.outcome === "skipped") return `Skipped ${when}: ${last.message ?? "nothing to do"}`;
  return `Couldn't sync ${when}: ${last.message ?? "unknown error"}`;
}
```

In `packages/shared/package.json`, add `"src/main-sync.ts"` to `files` (after `"src/usage.ts"`) and to `exports` after `"./usage": "./src/usage.ts",`:

```json
    "./main-sync": "./src/main-sync.ts",
```

- [ ] **Step 4: Run the tests and the shared typecheck**

Run: `node --test packages/shared/src/main-sync.test.ts && npm run typecheck --workspace @milagre/shared`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/main-sync.ts packages/shared/src/main-sync.test.ts packages/shared/package.json
git commit -m "feat: shared copy for main branch sync status"
```

---

### Task 5: Desktop settings

**Files:**
- Modify: `apps/desktop/electron/preload.cjs` (after `saveWorktreeSetup`, line 65)
- Modify: `apps/desktop/app/src/electron.d.ts` (after `saveWorktreeSetup`, line 159)
- Modify: `apps/desktop/app/src/components/Settings.tsx` (`GeneralSettings` at line 203, `ProjectSettings` at line 1032)
- Create: `scripts/test-main-sync-settings.cjs`

**Interfaces:**
- Consumes: the four commands and the `main-sync:status` event (Task 3); everything from `@milagre/shared/main-sync` (Task 4).
- Produces: `window.milagre.readMainSync`, `saveMainSync`, `readMainSyncDefault`, `saveMainSyncDefault`, `onMainSyncStatus`; exported components `MainSyncDefaultSetting()` and `MainSyncSetting({ projectPath })` from `Settings.tsx`.

- [ ] **Step 1: Write the failing Electron check**

Create `scripts/test-main-sync-settings.cjs` by copying `scripts/test-experimental-settings.cjs` and changing these parts. The fixture:

```js
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MainSyncDefaultSetting, MainSyncSetting } from '/src/components/Settings';
import '/src/styles.css';
const state = { defaultValue: false, override: null, last: { at: Date.now() - 3 * 60000, outcome: 'skipped', branch: 'main', message: 'The main checkout has uncommitted changes' } };
const listeners = [];
const view = () => ({ branch: 'main', override: state.override, defaultValue: state.defaultValue, enabled: state.override ?? state.defaultValue, last: state.last });
window.milagre = {
  readMainSyncDefault: async () => ({ syncMain: state.defaultValue }),
  saveMainSyncDefault: async (value) => { state.defaultValue = value; return { syncMain: value }; },
  readMainSync: async () => view(),
  saveMainSync: async (_path, override) => { state.override = override; return view(); },
  onMainSyncStatus: (callback) => { listeners.push(callback); return () => {}; },
};
window.__mainSync = { state, emit: (last) => listeners.forEach((callback) => callback({ projectPath: '/work/shop', last })) };
createRoot(document.getElementById('root')).render(
  <div style={{ padding: 12, width: 720 }}><MainSyncDefaultSetting /><MainSyncSetting projectPath="/work/shop" /></div>,
);
`;
```

The checks inside `browserChecks()`'s `try` (replace the experimental ones; keep `waitFor`, `screenshot`, `errors`):

```js
    await window.loadURL(process.argv[2]);
    const toggle = `document.querySelector('[role="switch"][aria-label="Sync main branch before new Worktrees"]')`;
    const row = `document.querySelector('[data-main-sync]')`;
    await waitFor(`!!${toggle} && ${row}?.textContent.includes('Skipped 3 min ago: The main checkout has uncommitted changes')`);
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-checked')`), "false", "Off by default");
    await screenshot("default-off");
    await evaluate(`${toggle}.click()`);
    await waitFor(`window.__mainSync.state.defaultValue === true && ${toggle}.getAttribute('aria-checked') === 'true'`);
    await evaluate(`document.querySelector('button[aria-label="Sync main before new Worktrees"]').click()`);
    await waitFor(`[...document.querySelectorAll('[role="option"]')].some(o => o.textContent.trim() === 'Off')`);
    await evaluate(`[...document.querySelectorAll('[role="option"]')].find(o => o.textContent.trim() === 'Off').click()`);
    await waitFor(`window.__mainSync.state.override === false`);
    await evaluate(`window.__mainSync.emit({ at: Date.now(), outcome: 'updated', branch: 'main', commit: 'a1b2c3d' })`);
    await waitFor(`${row}.textContent.includes('Synced main just now (a1b2c3d)')`);
    await screenshot("project-synced");
    assert.deepEqual(errors, []);
    console.log("PASS: the global main sync switch and the Project's choice save, and the status line follows main-sync:status");
```

Rename the Vite plugin, virtual ids and paths from `experimental-settings` to `main-sync-settings` (including `cacheDir: node_modules/.vite-main-sync-settings` and the `userData` temp prefix) so it never shares a cache with the other check.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --only main-sync-settings`
Expected: FAIL, Vite reports `MainSyncDefaultSetting` is not exported by `Settings.tsx`.

- [ ] **Step 3: Add the renderer API**

In `apps/desktop/electron/preload.cjs`, after `saveWorktreeSetup`:

```js
  readMainSync: (projectPath) => ipcRenderer.invoke("main-sync:read", projectPath),
  saveMainSync: (projectPath, override) => ipcRenderer.invoke("main-sync:save", projectPath, override),
  readMainSyncDefault: () => ipcRenderer.invoke("main-sync:default:read"),
  saveMainSyncDefault: (value) => ipcRenderer.invoke("main-sync:default:save", value),
  onMainSyncStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("main-sync:status", listener);
    return () => ipcRenderer.removeListener("main-sync:status", listener);
  },
```

In `apps/desktop/app/src/electron.d.ts`, add `import type { MainSyncSettings, MainSyncStatus } from "@milagre/shared/main-sync";` with the other imports, and after `saveWorktreeSetup`:

```ts
      /** Whether new Worktrees sync the main branch first, and the last sync's result. */
      readMainSync: (projectPath: string) => Promise<MainSyncSettings>;
      /** null brings the global default back. */
      saveMainSync: (projectPath: string, override: boolean | null) => Promise<MainSyncSettings>;
      readMainSyncDefault: () => Promise<{ syncMain: boolean }>;
      saveMainSyncDefault: (value: boolean) => Promise<{ syncMain: boolean }>;
      /** A main branch sync finished, before a new Worktree. */
      onMainSyncStatus: (callback: (status: MainSyncStatus) => void) => () => void;
```

Check `apps/desktop/electron/daemon-runtime.cjs` `forward()` (line 57) and the main-process code it emits into: daemon events reach the renderer by channel name. If any allowlist of event channels exists between them, add `"main-sync:status"` to it.

- [ ] **Step 4: Add the components**

In `apps/desktop/app/src/components/Settings.tsx`, add the import:

```ts
import { MAIN_SYNC_HINT, MAIN_SYNC_TITLE, choiceOf, mainSyncChoices, mainSyncProjectTitle, mainSyncStatusLine, overrideOf } from "@milagre/shared/main-sync";
import type { MainSyncChoice, MainSyncSettings } from "@milagre/shared/main-sync";
```

Add before `ProjectSettings`:

```tsx
// The global default for main branch sync; each Project can override it. Kept by the daemon, which runs the sync.
export function MainSyncDefaultSetting() {
  const [syncMain, setSyncMain] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.milagre.readMainSyncDefault().then(
      (value) => setSyncMain(value.syncMain),
      () => setSyncMain(false),
    );
  }, []);
  async function change(next: boolean) {
    setError(null);
    setSyncMain(next);
    try {
      setSyncMain((await window.milagre.saveMainSyncDefault(next)).syncMain);
    } catch (failure) {
      setSyncMain(!next);
      setError(ipcErrorMessage(failure));
    }
  }
  return (
    <div data-main-sync-default>
      <Row label={MAIN_SYNC_TITLE} description={MAIN_SYNC_HINT}>
        <Switch label={MAIN_SYNC_TITLE} checked={syncMain === true} onChange={(next) => void change(next)} />
      </Row>
      {error && <p className="px-4 pb-3 break-words text-[12px] text-red">{error}</p>}
    </div>
  );
}

export function MainSyncSetting({ projectPath }: { projectPath: string }) {
  const [sync, setSync] = useState<MainSyncSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    window.milagre.readMainSync(projectPath).then(
      (value) => live && setSync(value),
      (failure) => live && setError(ipcErrorMessage(failure)),
    );
    const stop = window.milagre.onMainSyncStatus((status) => {
      if (status.projectPath !== projectPath) return;
      setNow(Date.now());
      setSync((current) => (current ? { ...current, last: status.last } : current));
    });
    return () => {
      live = false;
      stop();
    };
  }, [projectPath]);
  async function change(choice: MainSyncChoice) {
    setError(null);
    try {
      setSync(await window.milagre.saveMainSync(projectPath, overrideOf(choice)));
    } catch (failure) {
      setError(ipcErrorMessage(failure));
    }
  }
  const title = mainSyncProjectTitle(sync?.branch ?? "main");
  return (
    <div data-main-sync>
      <Row label={title} description={sync ? mainSyncStatusLine(sync.last, now) : undefined}>
        <Select<MainSyncChoice>
          label={title}
          value={choiceOf(sync?.override ?? null)}
          onChange={(choice) => void change(choice)}
          options={mainSyncChoices(sync?.defaultValue ?? false).map((choice) => ({ value: choice.value, label: choice.title }))}
        />
      </Row>
      {error && <p className="px-4 pb-3 break-words text-[12px] text-red">{error}</p>}
    </div>
  );
}
```

In `GeneralSettings`, add a group between "Agents" and the next group:

```tsx
      <Group title="Worktrees">
        <MainSyncDefaultSetting />
      </Group>
```

In `ProjectSettings`, add before the "New worktrees" group:

```tsx
      <Group title="Main branch">
        <MainSyncSetting projectPath={project.path} />
      </Group>
```

- [ ] **Step 5: Run the check, typecheck and lint**

Run: `npm test -- --only main-sync-settings && npm run typecheck && npm run lint`
Expected: `PASS: the global main sync switch ...`, no type or lint errors. Then run `MILAGRE_SCREENSHOT_DIR=$TMPDIR/main-sync npm test -- --only main-sync-settings` and keep the two screenshots for the PR.

- [ ] **Step 6: Try it in the dev app**

Run `npm run dev` on its own ports and profile (never touch the running Milagre; see the dev docs in `docs/development.md`). On a Project whose main is behind its remote:
1. Settings > General: turn on "Sync main branch before new Worktrees".
2. Start a new chat in a new Worktree.
3. Project settings show "Synced main just now (<sha>)" and `git -C <project> log -1 main` matches `origin/main`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/app/src/electron.d.ts apps/desktop/app/src/components/Settings.tsx scripts/test-main-sync-settings.cjs
git commit -m "feat: main branch sync settings on desktop"
```

---

### Task 6: Mobile settings

**Files:**
- Modify: `apps/mobile/src/app/settings.tsx` (`SettingsView`)
- Modify: `apps/mobile/src/app/project-settings.tsx`

**Interfaces:**
- Consumes: `main-sync:read`, `main-sync:save`, `main-sync:default:read`, `main-sync:default:save` through `session.client.call<T>(method, params)`; `@milagre/shared/main-sync` (Task 4); `Toggle`, `Segmented`, `styles` from `apps/mobile/src/ui.tsx`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Global switch**

In `apps/mobile/src/app/settings.tsx`, add imports:

```ts
import { useEffect, useState } from "react";
import { MAIN_SYNC_HINT, MAIN_SYNC_TITLE } from "@milagre/shared/main-sync";
```

Inside `SettingsView`, after `const projects = ...`:

```tsx
  // The computer's global default for main branch sync; null until it answers (an older Mac never does).
  const [syncMain, setSyncMain] = useState<boolean | null>(null);
  useEffect(() => {
    const client = session.client;
    if (!client) return;
    let live = true;
    client.call<{ syncMain: boolean }>("main-sync:default:read", []).then(
      (value) => live && setSyncMain(value.syncMain),
      () => live && setSyncMain(null),
    );
    return () => {
      live = false;
    };
  }, [session.client]);
  async function changeSyncMain(next: boolean) {
    const client = session.client;
    if (!client) return;
    setSyncMain(next);
    try {
      setSyncMain((await client.call<{ syncMain: boolean }>("main-sync:default:save", [next])).syncMain);
    } catch {
      setSyncMain(!next);
    }
  }
```

In the returned JSX, right before the `{/* The connected computer's Projects; each opens its own settings. */}` block:

```tsx
      {session.client && syncMain !== null && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>Worktrees</Text>
          <View style={[styles.card, { gap: 4 }]}>
            <Toggle title={MAIN_SYNC_TITLE} selected={syncMain} onPress={() => void changeSyncMain(!syncMain)} />
            <Text style={styles.caption}>{MAIN_SYNC_HINT}</Text>
          </View>
        </>
      )}
```

- [ ] **Step 2: Per-Project choice and status**

In `apps/mobile/src/app/project-settings.tsx`, change the imports:

```ts
import { useCallback, useState } from "react";
import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { choiceOf, mainSyncChoices, mainSyncProjectTitle, mainSyncStatusLine, overrideOf } from "@milagre/shared/main-sync";
import type { MainSyncChoice, MainSyncSettings } from "@milagre/shared/main-sync";
import { ErrorNotice, PageScroll, PillButton, Segmented, Toggle, styles } from "../ui";
```

In `ProjectSettingsScreen`, after `const client = session.client;` and before the `if (!client || !path)` return:

```tsx
  // Re-read on every focus: the phone doesn't get main-sync:status, and a sync may have run on the Mac since.
  const [sync, setSync] = useState<MainSyncSettings | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      if (!client || !path) return;
      let live = true;
      setNow(Date.now());
      client.call<MainSyncSettings>("main-sync:read", [path]).then(
        (value) => live && setSync(value),
        () => live && setSync(null),
      );
      return () => {
        live = false;
      };
    }, [client, path]),
  );
```

After the `if (!client || !path)` return, add:

```tsx
  async function changeSync(choice: MainSyncChoice) {
    setError("");
    try {
      setSync(await client!.call<MainSyncSettings>("main-sync:save", [path, overrideOf(choice)]));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change this setting.");
    }
  }
```

In the JSX, after the "Projects list" card and before `{error ? <ErrorNotice ...`:

```tsx
        {sync && (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>Main branch</Text>
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.caption}>{mainSyncProjectTitle(sync.branch)}</Text>
              <Segmented
                label={mainSyncProjectTitle(sync.branch)}
                value={choiceOf(sync.override)}
                options={mainSyncChoices(sync.defaultValue)}
                onChange={(value) => void changeSync(value as MainSyncChoice)}
              />
              <Text style={styles.caption}>{mainSyncStatusLine(sync.last, now)}</Text>
            </View>
          </>
        )}
```

- [ ] **Step 3: Typecheck and confirm no new native code**

Run: `npm run typecheck:mobile`
Expected: no errors. Then follow `apps/mobile/AGENTS.md` to compare the runtime fingerprint against the TestFlight build; it must be unchanged (no new dependency, no `app.json` change).

- [ ] **Step 4: Check it on a simulator**

Use a local dev build of the mobile app (Expo Go is broken for this app) on a slimmed iOS simulator, paired with the dev daemon from Task 5 Step 6, and attach the simulator to this Chat.
1. Settings: the "Worktrees" card shows the switch; flipping it flips the desktop General switch after the desktop screen reopens.
2. Project settings for the same Project: "Main branch" shows the three choices and the last status line from the desktop run.
3. Pick "Off", go back, reopen: "Off" is still selected.
Take a screenshot of each screen for the PR.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/settings.tsx apps/mobile/src/app/project-settings.tsx
git commit -m "feat: main branch sync settings on the phone"
```

---

### Task 7: Full checks and PR

**Files:** none new.

- [ ] **Step 1: Run every required check**

Run: `npm run typecheck && npm run typecheck:mobile && npm run lint && npm test -- --unit && npm test -- --only main-sync-settings`
Expected: all pass. Fix and re-run anything that fails before going on.

- [ ] **Step 2: Push screenshots to the `screenshots` branch**

In a temporary worktree of `origin/screenshots` (never on the PR branch), add the desktop images from `$TMPDIR/main-sync` and the phone screenshots under `main-branch-sync/`, commit, push, and note the commit SHA.

- [ ] **Step 3: Open the PR**

Push the branch and open a PR with `gh pr create`. The body says what the sync does and doesn't do, the default (off), that mobile ships over the air with no new build, and links each screenshot as `https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/main-branch-sync/<name>.png`. No Claude attribution anywhere.
