import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasLink } from "@milagre/shared/chat-links";
import { linksOf, refreshLinks, setLinks } from "./links-store.ts";

const link = (id: string): CanvasLink => ({ id, a: { project_id: "a" }, b: { project_id: "b" }, created_at: "" });

/** A client whose canvas:links answers wait until the test releases them, in the order they were asked. */
function fakeClient() {
  const pending: Array<{ resolve: (links: CanvasLink[]) => void; reject: (error: Error) => void }> = [];
  const client = {
    call: <T>(method: string): Promise<T> => {
      if (method === "project:registry") return Promise.resolve([] as T);
      return new Promise<T>((resolve, reject) => pending.push({ resolve: resolve as (links: CanvasLink[]) => void, reject }));
    },
  };
  return { client, pending };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a Link change signalled while a read runs reads again, so the stale answer doesn't bring a removed Link back", async () => {
  const { client, pending } = fakeClient();
  const first = refreshLinks(client);
  await settle();
  // The Link is removed on the Mac while the first read is out; its signal arrives now.
  const second = refreshLinks(client);
  pending[0].resolve([link("removed")]);
  await settle();
  assert.equal(pending.length, 2, "a second read follows the first");
  pending[1].resolve([]);
  await Promise.all([first, second]);
  assert.deepEqual(linksOf(client)?.links, []);
});

test("a change the phone made while a read runs isn't undone by that read's older answer", async () => {
  const { client, pending } = fakeClient();
  const reading = refreshLinks(client);
  await settle();
  pending[0].resolve([link("old")]);
  await settle();
  const again = refreshLinks(client);
  await settle();
  setLinks(client, [link("old"), link("new")]);
  pending[1].resolve([link("old")]);
  await settle();
  assert.equal(pending.length, 3, "the change queued another read");
  pending[2].resolve([link("old"), link("new")]);
  await Promise.all([reading, again]);
  assert.deepEqual(
    linksOf(client)?.links.map((item) => item.id),
    ["old", "new"],
  );
});

test("a late answer or failure from the computer the phone left never touches the current computer's Links", async () => {
  const before = fakeClient();
  const now = fakeClient();
  const leaving = refreshLinks(before.client);
  const current = refreshLinks(now.client);
  await settle();
  now.pending[0].resolve([link("here")]);
  await current;
  // The old computer answers late, then a refresh of it fails.
  before.pending[0].resolve([link("there")]);
  await leaving;
  const failing = refreshLinks(before.client);
  await settle();
  before.pending[1].reject(new Error("Connection lost"));
  await failing;
  assert.deepEqual(
    linksOf(now.client)?.links.map((item) => item.id),
    ["here"],
  );
  assert.equal(linksOf(now.client)?.available, true);
  assert.deepEqual(
    linksOf(before.client)?.links.map((item) => item.id),
    ["there"],
    "a failure keeps what was read before",
  );
});
