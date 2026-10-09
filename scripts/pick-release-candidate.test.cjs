const assert = require("node:assert/strict");
const { test } = require("node:test");
const { pickCandidate } = require("./pick-release-candidate.cjs");

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
const beta = (options) => pickCandidate({ channel: "beta", ...options });
const stable = (options) => pickCandidate({ channel: "stable", ...options });

test("picks the newest draft stable candidate and numbers the beta after its existing betas", () => {
  const exec = fakeExec({ releases, commits: { "v1.4.0": "aaa" } });
  assert.deepEqual(beta({ exec }), { tag: "v1.4.0", version: "1.4.0-beta.2", releaseTag: "v1.4.0-beta.2", changed: true });
  const fresh = fakeExec({ releases: releases.filter((r) => r.tagName !== "v1.4.0-beta.1"), commits: { "v1.4.0": "aaa" } });
  assert.equal(beta({ exec: fresh }).version, "1.4.0-beta.1");
});

test("a beta number continues past numbers left by the old run-numbered workflow", () => {
  const withBetas = [...releases, release("v1.4.0-beta.12", "2026-10-06T12:00:00Z", { isPrerelease: true })];
  const exec = fakeExec({ releases: withBetas, commits: { "v1.4.0": "ccc", "v1.4.0-beta.12": "aaa" } });
  assert.equal(beta({ exec }).releaseTag, "v1.4.0-beta.13");
});

test("honors a requested draft and rejects one that is not a draft stable candidate", () => {
  const exec = fakeExec({ releases, commits: { "v1.3.0": "bbb" } });
  assert.equal(beta({ requested: "v1.3.0", exec }).tag, "v1.3.0");
  assert.throws(() => beta({ requested: "v1.2.0", exec }), /not a draft/);
  assert.throws(() => beta({ requested: "v1.4.0-beta.1", exec }), /not a draft/);
});

test("reports no change when a published beta already points at the same commit", () => {
  const withBeta = [...releases, release("v1.4.0-beta.40", "2026-10-06T09:00:00Z", { isPrerelease: true })];
  const same = fakeExec({ releases: withBeta, commits: { "v1.4.0": "aaa", "v1.4.0-beta.40": "aaa" } });
  assert.equal(beta({ exec: same }).changed, false);
  const moved = fakeExec({ releases: withBeta, commits: { "v1.4.0": "ccc", "v1.4.0-beta.40": "aaa" } });
  assert.equal(beta({ exec: moved }).changed, true);
});

test("a beta of another version does not suppress this candidate", () => {
  const other = [...releases, release("v1.3.0-beta.5", "2026-10-05T12:00:00Z", { isPrerelease: true })];
  const exec = fakeExec({ releases: other, commits: { "v1.4.0": "aaa" } });
  assert.equal(beta({ exec }).changed, true);
});

test("a scheduled beta with no draft candidate does nothing instead of failing", () => {
  const exec = fakeExec({ releases: [release("v1.2.0", "2026-10-01T10:00:00Z")], commits: {} });
  assert.deepEqual(beta({ exec }), { tag: "", version: "", releaseTag: "", changed: false });
});

test("an explicit request still fails when no draft exists", () => {
  const exec = fakeExec({ releases: [release("v1.2.0", "2026-10-01T10:00:00Z")], commits: {} });
  assert.throws(() => beta({ requested: "v1.2.0", exec }), /not a draft/);
  assert.throws(() => stable({ requested: "v1.2.0", exec }), /not a draft/);
});

test("ignores drafts that are not newer than the published stable and picks by version, not date", () => {
  const stale = [release("v0.95.3", "2026-10-06T15:53:00Z", { isDraft: true }), release("v0.96.0", "2026-10-06T20:13:00Z")];
  assert.deepEqual(beta({ exec: fakeExec({ releases: stale, commits: {} }) }), { tag: "", version: "", releaseTag: "", changed: false });
  assert.throws(() => beta({ requested: "v0.95.3", exec: fakeExec({ releases: stale, commits: {} }) }), /not newer than the published v0.96.0/);
  const mixed = [...stale, release("v0.97.0", "2026-10-06T21:00:00Z", { isDraft: true }), release("v0.96.1", "2026-10-06T22:00:00Z", { isDraft: true })];
  assert.equal(beta({ exec: fakeExec({ releases: mixed, commits: { "v0.97.0": "ddd" } }) }).tag, "v0.97.0");
});

test("stable publishes the draft itself, defaulting to the newest candidate, and fails when there is none", () => {
  const exec = fakeExec({ releases, commits: {} });
  assert.deepEqual(stable({ exec }), { tag: "v1.4.0", version: "1.4.0", releaseTag: "v1.4.0", changed: true });
  assert.deepEqual(stable({ requested: "v1.3.0", exec }), { tag: "v1.3.0", version: "1.3.0", releaseTag: "v1.3.0", changed: true });
  const none = fakeExec({ releases: [release("v1.2.0", "2026-10-01T10:00:00Z")], commits: {} });
  assert.throws(() => stable({ exec: none }), /No draft candidate is newer than the published v1.2.0/);
});

test("an unknown channel is rejected", () => {
  assert.throws(() => pickCandidate({ channel: "latest", exec: fakeExec({ releases, commits: {} }) }), /Unknown channel/);
});
