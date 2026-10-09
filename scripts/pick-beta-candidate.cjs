// Chooses the draft candidate Publish beta ships. Prints tag, version, beta_tag and changed for $GITHUB_OUTPUT.
const { execFileSync } = require("node:child_process");

const STABLE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const parseSemver = (tag) => tag.slice(1).split(".").map(Number);
const compareSemver = (a, b) => {
  const [x, y] = [parseSemver(a), parseSemver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const bySemverDesc = (a, b) => compareSemver(b.tagName, a.tagName);
const defaultExec = (command, args) => execFileSync(command, args, { encoding: "utf8" });

// gh resolves {owner}/{repo} from the checkout, and /commits/<tag> resolves a tag to its commit sha.
const commitOf = (exec, tag) => exec("gh", ["api", `repos/{owner}/{repo}/commits/${tag}`, "--jq", ".sha"]).trim();

function pickBetaCandidate({ requested, runNumber, exec = defaultExec }) {
  if (!/^\d+$/.test(String(runNumber ?? ""))) throw new Error("A numeric run number is required");
  const releases = JSON.parse(exec("gh", ["release", "list", "--json", "tagName,isDraft,isPrerelease,createdAt", "--limit", "50"]));
  const drafts = releases.filter((release) => release.isDraft && STABLE.test(release.tagName));
  // A draft older than the newest published stable is a leftover candidate; a beta built from it would sit behind
  // stable and never reach anyone (beta installs never downgrade), so only drafts newer than stable qualify.
  const stable = releases.filter((release) => !release.isDraft && !release.isPrerelease && STABLE.test(release.tagName)).toSorted(bySemverDesc)[0];
  const candidates = drafts.filter((release) => !stable || compareSemver(release.tagName, stable.tagName) > 0).toSorted(bySemverDesc);
  let draft;
  if (requested) {
    draft = drafts.find((release) => release.tagName === requested);
    if (!draft) throw new Error(`${requested} is not a draft stable release candidate`);
    if (stable && compareSemver(requested, stable.tagName) <= 0) throw new Error(`${requested} is not newer than the published ${stable.tagName}`);
  } else {
    draft = candidates[0];
    if (!draft) return { tag: "", version: "", betaTag: "", changed: false };
  }
  const tag = draft.tagName;
  const base = tag.slice(1);
  const version = `${base}-beta.${runNumber}`;
  const commit = commitOf(exec, tag);
  const existing = releases.filter((release) => release.isPrerelease && !release.isDraft && release.tagName.startsWith(`v${base}-beta.`));
  const changed = !existing.some((release) => commitOf(exec, release.tagName) === commit);
  return { tag, version, betaTag: `v${version}`, changed };
}

module.exports = { pickBetaCandidate };

if (require.main === module) {
  try {
    const { tag, version, betaTag, changed } = pickBetaCandidate({ requested: process.env.REQUESTED || undefined, runNumber: process.env.GITHUB_RUN_NUMBER });
    console.log(`tag=${tag}\nversion=${version}\nbeta_tag=${betaTag}\nchanged=${changed}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
