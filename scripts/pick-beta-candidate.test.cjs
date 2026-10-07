const assert = require("node:assert/strict");
const { test } = require("node:test");
const { pickBetaCandidate } = require("./pick-beta-candidate.cjs");

const release = (tagName, createdAt, extra = {}) => ({ tagName, createdAt, isDraft: false, isPrerelease: false, ...extra });
function fakeExec({ releases, commits }) {
  return (command, args) => {
    assert.equal(command, "gh");
    if (args[0] === "release") return JSON.stringify(releases);
    const tag = args[1].split("/").pop();
    assert.ok(commits[tag], `unexpected commit lookup for ${tag}`);
    return commits[tag] + "\n";
  };
}
const releases = [
  release("v1.3.0", "2026-10-05T10:00:00Z", { isDraft: true }),
  release("v1.4.0", "2026-10-06T10:00:00Z", { isDraft: true }),
  release("v1.4.0-beta.1", "2026-10-06T11:00:00Z", { isDraft: true }),
  release("v1.2.0", "2026-10-01T10:00:00Z"),
];

test("picks the newest draft stable candidate and numbers the beta from the run", () => {
  const exec = fakeExec({ releases, commits: { "v1.4.0": "aaa" } });
  assert.deepEqual(pickBetaCandidate({ runNumber: "42", exec }), { tag: "v1.4.0", version: "1.4.0-beta.42", betaTag: "v1.4.0-beta.42", changed: true });
});

test("honors a requested draft and rejects one that is not a draft stable candidate", () => {
  const exec = fakeExec({ releases, commits: { "v1.3.0": "bbb" } });
  assert.equal(pickBetaCandidate({ requested: "v1.3.0", runNumber: 7, exec }).tag, "v1.3.0");
  assert.throws(() => pickBetaCandidate({ requested: "v1.2.0", runNumber: 7, exec }), /not a draft/);
  assert.throws(() => pickBetaCandidate({ requested: "v1.4.0-beta.1", runNumber: 7, exec }), /not a draft/);
});

test("reports no change when a published beta already points at the same commit", () => {
  const withBeta = [...releases, release("v1.4.0-beta.40", "2026-10-06T09:00:00Z", { isPrerelease: true })];
  const same = fakeExec({ releases: withBeta, commits: { "v1.4.0": "aaa", "v1.4.0-beta.40": "aaa" } });
  assert.equal(pickBetaCandidate({ runNumber: 41, exec: same }).changed, false);
  const moved = fakeExec({ releases: withBeta, commits: { "v1.4.0": "ccc", "v1.4.0-beta.40": "aaa" } });
  assert.equal(pickBetaCandidate({ runNumber: 41, exec: moved }).changed, true);
});

test("a beta of another version does not suppress this candidate", () => {
  const other = [...releases, release("v1.3.0-beta.5", "2026-10-05T12:00:00Z", { isPrerelease: true })];
  const exec = fakeExec({ releases: other, commits: { "v1.4.0": "aaa" } });
  assert.equal(pickBetaCandidate({ runNumber: 8, exec }).changed, true);
});

test("a scheduled run with no draft candidate does nothing instead of failing", () => {
  const exec = fakeExec({ releases: [release("v1.2.0", "2026-10-01T10:00:00Z")], commits: {} });
  assert.deepEqual(pickBetaCandidate({ runNumber: 1, exec }), { tag: "", version: "", betaTag: "", changed: false });
});

test("an explicit request still fails when no draft exists", () => {
  const exec = fakeExec({ releases: [release("v1.2.0", "2026-10-01T10:00:00Z")], commits: {} });
  assert.throws(() => pickBetaCandidate({ requested: "v1.2.0", runNumber: 1, exec }), /not a draft/);
});
