import type { PullRequest } from "@milagre/shared/model";
import type { Client } from "./client";

type Job = { active: (() => boolean)[]; start: () => Promise<void>; skip: () => void };
type Pool = {
  running: number;
  queue: Job[];
  pending: Map<string, { promise: Promise<PullRequest | null | undefined>; job: Job }>;
  cache: Map<string, { at: number; value: PullRequest | null }>;
};
const pools = new WeakMap<Client, Pool>();
// Keep slow GitHub lookups out of the capacity used by snapshots and sends.
export function readPullRequest(client: Client, path: string, active: () => boolean): Promise<PullRequest | null | undefined> {
  let pool = pools.get(client);
  if (!pool) {
    pool = { running: 0, queue: [], pending: new Map(), cache: new Map() };
    pools.set(client, pool);
  }
  const state = pool;
  const cached = state.cache.get(path);
  if (cached && Date.now() - cached.at < 30000) return Promise.resolve(cached.value);
  const pending = state.pending.get(path);
  if (pending) {
    pending.job.active.push(active);
    return pending.promise;
  }
  function drain() {
    while (state.running < 2 && state.queue.length) {
      const job = state.queue.shift()!;
      if (!job.active.some((check) => check())) {
        job.skip();
        continue;
      }
      state.running++;
      void job.start().finally(() => {
        state.running--;
        drain();
      });
    }
  }
  let resolve!: (value: PullRequest | null | undefined) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<PullRequest | null | undefined>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const job: Job = {
    active: [active],
    skip: () => {
      state.pending.delete(path);
      resolve(undefined);
    },
    start: async () => {
      try {
        const value = await client.call<PullRequest | null>("worktree:pull-request", [path]);
        // Bound retained status for long sessions across many Projects.
        if (state.cache.size >= 200) state.cache.delete(state.cache.keys().next().value!);
        state.cache.set(path, { at: Date.now(), value });
        resolve(value);
      } catch (error) {
        reject(error);
      } finally {
        state.pending.delete(path);
      }
    },
  };
  state.pending.set(path, { promise, job });
  state.queue.push(job);
  drain();
  return promise;
}
