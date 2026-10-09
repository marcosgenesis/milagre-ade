// Chooses the draft candidate the Publish workflow ships. Prints tag, version, release_tag and changed for $GITHUB_OUTPUT.
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

function pickCandidate({ channel, requested, exec = defaultExec }) {
  if (channel !== "beta" && channel !== "stable") throw new Error(`Unknown channel: ${channel}; one of beta, stable`);
  const releases = JSON.parse(exec("gh", ["release", "list", "--json", "tagName,isDraft,isPrerelease,createdAt", "--limit", "100"]));
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
    if (!draft) {
      // A scheduled beta with nothing new does nothing; a stable release was asked for by hand, so it fails loudly.
      if (channel === "stable") throw new Error(`No draft candidate is newer than the published ${stable?.tagName ?? "release"}`);
      return { tag: "", version: "", releaseTag: "", changed: false };
    }
  }
  const tag = draft.tagName;
  const base = tag.slice(1);
  if (channel === "stable") return { tag, version: base, releaseTag: tag, changed: true };
  // Betas of one candidate count up from its highest existing number, so a newer beta always sorts above an older one.
  const betas = releases.filter((release) => release.tagName.startsWith(`v${base}-beta.`));
  const next = Math.max(0, ...betas.map((release) => Number(release.tagName.slice(`v${base}-beta.`.length)) || 0)) + 1;
  const version = `${base}-beta.${next}`;
  const commit = commitOf(exec, tag);
  const published = betas.filter((release) => release.isPrerelease && !release.isDraft);
  const changed = !published.some((release) => commitOf(exec, release.tagName) === commit);
  return { tag, version, releaseTag: `v${version}`, changed };
}

module.exports = { pickCandidate };

if (require.main === module) {
  try {
    const { tag, version, releaseTag, changed } = pickCandidate({ channel: process.env.CHANNEL, requested: process.env.REQUESTED || undefined });
    console.log(`tag=${tag}\nversion=${version}\nrelease_tag=${releaseTag}\nchanged=${changed}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
