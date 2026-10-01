import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderUsage, UsageSnapshot } from "../../model";
import { formatResetsIn, formatUpdatedAgo, mergeSnapshot, usageLabel, usageTone, visibleProviders } from "./format.ts";

const NOW = Date.parse("2026-10-01T19:30:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function claude(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    provider: "claude",
    status: "ok",
    updatedAt: at(0),
    windows: [
      { id: "session", label: "Session", shortLabel: "5h", usedPercent: 73, resetsAt: at(77 * MINUTE) },
      { id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 61, resetsAt: at(5 * DAY) },
      { id: "weekly:fable", label: "Fable", shortLabel: "wk", usedPercent: 66, resetsAt: at(5 * DAY) },
    ],
    ...overrides,
  };
}

test("formats reset countdowns and never shows a negative one", () => {
  assert.equal(formatResetsIn(null, NOW), null);
  assert.equal(formatResetsIn("not a date", NOW), null);
  assert.equal(formatResetsIn(at(-1_000), NOW), "Resetting…");
  assert.equal(formatResetsIn(at(0), NOW), "Resetting…");
  assert.equal(formatResetsIn(at(30_000), NOW), "Resets in 1m");
  assert.equal(formatResetsIn(at(45 * MINUTE), NOW), "Resets in 45m");
  assert.equal(formatResetsIn(at(77 * MINUTE), NOW), "Resets in 1h 17m");
  assert.equal(formatResetsIn(at(39 * HOUR + 59 * MINUTE), NOW), "Resets in 1d 15h");
  assert.equal(formatResetsIn(at(5 * DAY), NOW), "Resets in 5d 0h");
});

test("formats how long ago usage was read, tolerating clock skew", () => {
  assert.equal(formatUpdatedAgo(at(-10_000), NOW), "Updated just now");
  assert.equal(formatUpdatedAgo(at(MINUTE), NOW), "Updated just now");
  assert.equal(formatUpdatedAgo(at(-3 * MINUTE), NOW), "Updated 3m ago");
  assert.equal(formatUpdatedAgo(at(-2 * HOUR), NOW), "Updated 2h ago");
  assert.equal(formatUpdatedAgo(at(-3 * DAY), NOW), "Updated 3d ago");
});

test("picks a tone from the rounded percentage", () => {
  assert.equal(usageTone(79.4), "normal");
  assert.equal(usageTone(79.6), "warning");
  assert.equal(usageTone(94.4), "warning");
  assert.equal(usageTone(95), "critical");
  assert.equal(usageTone(100), "critical");
});

test("keeps the last good numbers when a refresh fails", () => {
  const previous: UsageSnapshot = { providers: [claude({ updatedAt: at(-6 * MINUTE) })] };
  const failed: UsageSnapshot = { providers: [claude({ status: "error", windows: [], message: "Claude is rate limiting usage checks. Try again in a minute." })] };

  const merged = mergeSnapshot(previous, failed);
  assert.deepEqual(merged.providers[0].windows, previous.providers[0].windows);
  assert.equal(merged.providers[0].updatedAt, at(-6 * MINUTE));
  assert.equal(merged.providers[0].status, "error");
  assert.equal(merged.providers[0].message, "Claude is rate limiting usage checks. Try again in a minute.");

  const failedAgain = mergeSnapshot(merged, failed);
  assert.deepEqual(failedAgain.providers[0].windows, previous.providers[0].windows);
  assert.equal(failedAgain.providers[0].updatedAt, at(-6 * MINUTE));

  const recovered = mergeSnapshot(failedAgain, { providers: [claude()] });
  assert.equal(recovered.providers[0].status, "ok");
  assert.equal(recovered.providers[0].message, undefined);
});

test("does not invent data for a first-time error or keep data for an unavailable provider", () => {
  const failed: UsageSnapshot = { providers: [claude({ status: "error", windows: [], message: "Couldn't reach Claude." })] };
  assert.deepEqual(mergeSnapshot(null, failed), failed);
  const gone: UsageSnapshot = { providers: [claude({ status: "unavailable", windows: [], message: "Not signed in to Claude Code." })] };
  assert.deepEqual(mergeSnapshot({ providers: [claude()] }, gone), gone);
});

test("hides unavailable providers and labels segments for screen readers", () => {
  const codexMissing: ProviderUsage = { provider: "codex", status: "unavailable", windows: [], updatedAt: at(0), message: "Codex CLI not found." };
  assert.deepEqual(visibleProviders({ providers: [claude(), codexMissing] }).map((item) => item.provider), ["claude"]);
  assert.equal(usageLabel(claude()), "Claude usage: Session 73% used, Weekly 61% used");
  assert.equal(usageLabel(claude({ status: "error", windows: [] })), "Claude usage unavailable");
});
