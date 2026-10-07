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
