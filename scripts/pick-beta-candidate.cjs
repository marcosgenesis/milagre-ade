// Chooses the draft candidate Publish beta ships. Prints tag, version, beta_tag and changed for $GITHUB_OUTPUT.
const { execFileSync } = require("node:child_process");

const STABLE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const defaultExec = (command, args) => execFileSync(command, args, { encoding: "utf8" });

// gh resolves {owner}/{repo} from the checkout, and /commits/<tag> resolves a tag to its commit sha.
const commitOf = (exec, tag) => exec("gh", ["api", `repos/{owner}/{repo}/commits/${tag}`, "--jq", ".sha"]).trim();

function pickBetaCandidate({ requested, runNumber, exec = defaultExec }) {
  if (!/^\d+$/.test(String(runNumber ?? ""))) throw new Error("A numeric run number is required");
  const releases = JSON.parse(exec("gh", ["release", "list", "--json", "tagName,isDraft,isPrerelease,createdAt", "--limit", "50"]));
  const drafts = releases.filter((release) => release.isDraft && STABLE.test(release.tagName));
  let draft;
  if (requested) {
    draft = drafts.find((release) => release.tagName === requested);
    if (!draft) throw new Error(`${requested} is not a draft stable release candidate`);
  } else {
    draft = drafts.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
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
