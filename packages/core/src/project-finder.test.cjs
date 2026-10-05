const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createProjectFinder, rankRepositories, scanRepositories } = require("./project-finder.cjs");

async function tree(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-finder-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  for (const folder of ["Code/shop/.git", "Code/shop/packages/inner/.git", "Code/blog/.git", "Library/hidden-repo/.git", ".config/dot-repo/.git", "Code/app/node_modules/dep/.git", "Documents/notes"]) {
    await fs.mkdir(path.join(home, folder), { recursive: true });
  }
  await fs.writeFile(path.join(home, "Code/blog/README.md"), "# blog\n");
  return home;
}

test("the scan finds repositories, stops at each one and skips hidden, system and dependency folders", async (t) => {
  const home = await tree(t);
  const found = (await scanRepositories(home)).map(repo => path.relative(home, repo.path)).sort();
  assert.deepEqual(found, ["Code/blog", "Code/shop"]);
});

test("the scan gives up when its time budget runs out", async () => {
  let clock = 0;
  const readdir = async () => { clock += 3000; return [{ name: "deeper", isDirectory: () => true }]; };
  assert.deepEqual(await scanRepositories("/home", { now: () => clock, readdir }), []);
});

test("results rank name matches before path matches, prefixes first", () => {
  const repos = [{ name: "my-shop", path: "/h/a/my-shop" }, { name: "shop", path: "/h/Code/shop" }, { name: "web", path: "/h/shop-sites/web" }, { name: "blog", path: "/h/blog" }];
  assert.deepEqual(rankRepositories(repos, "shop").map(repo => repo.name), ["shop", "my-shop", "web"]);
  assert.equal(rankRepositories(repos, "").length, 4);
});

test("searching reuses one scan for a minute", async () => {
  let scans = 0;
  let clock = 0;
  const finder = createProjectFinder("/h", { now: () => clock, scan: async () => { scans++; return [{ name: "shop", path: "/h/shop" }]; } });
  await finder.search("s"); await finder.search("sh");
  assert.equal(scans, 1);
  clock += 61_000;
  assert.deepEqual(await finder.search("shop"), [{ name: "shop", path: "/h/shop" }]);
  assert.equal(scans, 2);
});
