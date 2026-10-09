const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { listDirs } = require("./remote-files.cjs");

/** A home folder: Code/billing (a checkout on main), Code/web (a Project), Code/tree (a worktree's .git file), notes, a hidden folder, links in and out. */
async function home(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "remote-files-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const outside = path.join(root, "outside");
  await fs.mkdir(path.join(homeDir, "Code", "billing", ".git"), { recursive: true });
  await fs.writeFile(path.join(homeDir, "Code", "billing", ".git", "HEAD"), "ref: refs/heads/main\n");
  await fs.mkdir(path.join(homeDir, "Code", "web", ".git"), { recursive: true });
  await fs.writeFile(path.join(homeDir, "Code", "web", ".git", "HEAD"), "ref: refs/heads/feature/x\n");
  await fs.mkdir(path.join(homeDir, "Code", "tree"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".gitdirs", "tree"), { recursive: true });
  await fs.writeFile(path.join(homeDir, ".gitdirs", "tree", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
  await fs.writeFile(path.join(homeDir, "Code", "tree", ".git"), "gitdir: ../../.gitdirs/tree\n");
  await fs.mkdir(path.join(homeDir, "notes"));
  await fs.mkdir(path.join(homeDir, ".hidden"));
  await fs.writeFile(path.join(homeDir, "readme.txt"), "not a folder");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(homeDir, "escape"));
  await fs.symlink(path.join(homeDir, "Code"), path.join(homeDir, "code-link"));
  return { homeDir, outside, options: { home: homeDir, projectPaths: async () => [path.join(homeDir, "Code", "web")] } };
}

test("the home folder lists its visible folders, a link inside it included and one leading out left out", async (t) => {
  const { homeDir, options } = await home(t);
  const listing = await listDirs(undefined, options);
  assert.equal(listing.path, homeDir);
  assert.equal(listing.home, homeDir);
  assert.equal(listing.parent, null);
  assert.deepEqual(
    listing.entries.map((entry) => [entry.name, entry.path]),
    [
      ["Code", path.join(homeDir, "Code")],
      ["code-link", path.join(homeDir, "Code")],
      ["notes", path.join(homeDir, "notes")],
    ],
  );
});

test("a folder's checkouts say their branch and whether they are already a Project", async (t) => {
  const { homeDir, options } = await home(t);
  const listing = await listDirs({ path: path.join(homeDir, "Code") }, options);
  assert.equal(listing.parent, homeDir);
  assert.deepEqual(
    listing.entries.map(({ name, git, branch, project }) => [name, git, branch, project]),
    [
      ["billing", true, "main", false],
      ["tree", true, null, false],
      ["web", true, "feature/x", true],
    ],
  );
});

test("a path outside the home folder, up out of it, relative, or through a link leading out is refused", async (t) => {
  const { homeDir, outside, options } = await home(t);
  for (const asked of [outside, "/etc", path.join(homeDir, ".."), `${homeDir}/../outside`, "Code", path.join(homeDir, "escape"), "C:\\Windows", 7])
    await assert.rejects(
      listDirs({ path: asked }, options),
      { code: "OUTSIDE_HOME", message: "Only folders in the home folder can be listed." },
      String(asked),
    );
});

test("a listing holds at most 500 entries", async (t) => {
  const { homeDir, options } = await home(t);
  const many = path.join(homeDir, "many");
  await fs.mkdir(many);
  await Promise.all(Array.from({ length: 520 }, (_, index) => fs.mkdir(path.join(many, `d${index}`))));
  assert.equal((await listDirs({ path: many }, options)).entries.length, 500);
});
