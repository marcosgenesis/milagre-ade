import test from "node:test";
import assert from "node:assert/strict";
import { followTerminal } from "./terminal-client.mjs";
import type { TerminalRead } from "./terminal.ts";

function host(reads: (TerminalRead | Error)[]) {
  const calls: { method: string; request: Record<string, unknown> }[] = [];
  let release: () => void = () => {};
  const api = {
    async read(request: { terminalId: string; after: number; limit?: number }) {
      calls.push({ method: "read", request });
      const next = reads.shift();
      if (!next) return new Promise<TerminalRead>(() => {});
      if (next instanceof Error) throw next;
      return next;
    },
    async input(request: { terminalId: string; data: string }) {
      calls.push({ method: "input", request });
      await new Promise<void>((resolve) => (release = resolve));
      return { accepted: true };
    },
    async resize(request: { terminalId: string; cols: number; rows: number }) {
      calls.push({ method: "resize", request });
      return null;
    },
  };
  return { api, calls, release: () => release() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a viewer replays the kept output, then appends what follows from its offset", async () => {
  const { api, calls } = host([
    { offset: 5, data: "hello", reset: true, ended: false },
    { offset: 8, data: " hi", reset: false, ended: false },
    { offset: 8, data: "", reset: false, ended: true },
  ]);
  const shown: string[] = [];
  let ended = 0;
  followTerminal({ terminalId: "t", api, write: (data) => shown.push(`+${data}`), reset: (data) => shown.push(`=${data}`), ended: () => ended++ });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, ["=hello", "+ hi"]);
  assert.deepEqual(
    calls.filter((call) => call.method === "read").map((call) => call.request.after),
    [0, 5, 8],
  );
  assert.equal(ended, 1);
});

test("the next read waits until the viewer has drawn the last output", async () => {
  const { api, calls } = host([
    { offset: 5, data: "hello", reset: true, ended: false },
    { offset: 8, data: " hi", reset: false, ended: false },
  ]);
  let drawn: () => void = () => {};
  followTerminal({ terminalId: "t", api, write: () => {}, reset: () => new Promise<void>((resolve) => (drawn = resolve)), readLimit: 4096 });
  for (let i = 0; i < 5; i++) await tick();
  const reads = () => calls.filter((call) => call.method === "read").map((call) => call.request);
  assert.deepEqual(reads(), [{ terminalId: "t", after: 0, limit: 4096 }]);
  drawn();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(
    reads().map((request) => request.after),
    [0, 5, 8],
  );
});

test("a viewer that drops a write keeps reading", async () => {
  const { api, calls } = host([
    { offset: 5, data: "hello", reset: true, ended: false },
    { offset: 8, data: " hi", reset: false, ended: false },
  ]);
  const shown: string[] = [];
  followTerminal({
    terminalId: "t",
    api,
    reset: () => {
      throw new Error("write data discarded, use flow control to avoid losing data");
    },
    write: (data) => shown.push(data),
  });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, [" hi"]);
  assert.deepEqual(
    calls.filter((call) => call.method === "read").map((call) => call.request.after),
    [0, 5, 8],
  );
});

test("typing while a send is out is joined into the next send, in order", async () => {
  const { api, calls, release } = host([]);
  const follower = followTerminal({ terminalId: "t", api, write: () => {}, reset: () => {} });
  follower.send("l");
  follower.send("s");
  follower.send("\r");
  await tick();
  release();
  await tick();
  await tick();
  release();
  await tick();
  assert.deepEqual(
    calls.filter((call) => call.method === "input").map((call) => call.request.data),
    ["l", "s\r"],
  );
  follower.stop();
});

test("a failed read retries instead of ending the viewer", async () => {
  const { api, calls } = host([new Error("host away"), { offset: 2, data: "ok", reset: true, ended: true }]);
  const shown: string[] = [];
  followTerminal({ terminalId: "t", api, write: () => {}, reset: (data) => shown.push(data), wait: async () => {} });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, ["ok"]);
  assert.equal(calls.filter((call) => call.method === "read").length, 2);
});

test("only the latest size is sent while one is out", async () => {
  const { api, calls } = host([]);
  const follower = followTerminal({ terminalId: "t", api, write: () => {}, reset: () => {} });
  follower.resize(80, 24);
  follower.resize(100, 30);
  follower.resize(120, 40);
  follower.resize(0, 40);
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(
    calls.filter((call) => call.method === "resize").map((call) => [call.request.cols, call.request.rows]),
    [
      [80, 24],
      [120, 40],
    ],
  );
  follower.stop();
});
