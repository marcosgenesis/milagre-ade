import { test } from "node:test";
import assert from "node:assert/strict";
import { readPullRequest } from "./pr-status.ts";
import type { Client } from "./client.ts";
test("slow PR requests are capped, deduplicated, and skipped when their screen leaves", async () => {
  const pending: (() => void)[] = [];
  let count = 0;
  const client = {
    call: () => {
      count++;
      return new Promise((resolve) => pending.push(() => resolve(null)));
    },
  } as unknown as Client;
  let focused = true;
  const requests = Array.from({ length: 20 }, (_, i) => readPullRequest(client, `/w/${i}`, () => focused));
  const duplicate = readPullRequest(client, "/w/0", () => focused);
  assert.equal(count, 2);
  assert.equal(duplicate, requests[0]);
  focused = false;
  pending.forEach((resolve) => resolve());
  const results = await Promise.all(requests);
  assert.equal(count, 2);
  assert.equal(results.filter((value) => value === undefined).length, 18);
  await readPullRequest(client, "/w/0", () => true);
  assert.equal(count, 2);
});

test("chat PR references resolve separately from the current branch and share queued requests", async () => {
  const calls: unknown[][] = [];
  const branch = { number: 248, state: "OPEN" };
  const merged = { number: 246, state: "MERGED" };
  const client = {
    call: async (method: string, args: unknown[]) => {
      calls.push([method, args]);
      return method === "worktree:pull-request" ? branch : [merged];
    },
  } as unknown as Client;
  const ref = "https://github.com/example/project/pull/246";
  const first = readPullRequest(client, "/w", () => true, ref);
  const same = readPullRequest(client, "/w", () => true, ref);
  assert.equal(first, same);
  assert.equal(await first, merged);
  assert.equal(await readPullRequest(client, "/w", () => true), branch);
  assert.deepEqual(calls, [
    ["worktree:pull-requests", ["/w", [ref]]],
    ["worktree:pull-request", ["/w"]],
  ]);
  await readPullRequest(client, "/w", () => true, ref);
  assert.equal(calls.length, 2, "the same merged PR is cached");
});
