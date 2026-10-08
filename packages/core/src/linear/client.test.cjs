const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLinearClient } = require("./client.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function memoryStore(token) {
  let saved = token;
  return {
    readToken: () => saved,
    saveToken: (next) => (saved = next),
    clearToken: () => (saved = null),
    get saved() {
      return saved;
    },
  };
}
const fresh = {
  accessToken: "a1",
  refreshToken: "r1",
  expiresAt: 10_000_000,
  viewer: { name: "V", email: "v@x" },
  organization: { name: "Acme", urlKey: "acme" },
};
const expiring = { ...fresh, expiresAt: 1000 + 60_000 };

test("a query posts the bearer token and returns data", async () => {
  let sent;
  const client = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async (url, init) => ((sent = { url, init }), json(200, { data: { viewer: { id: "u" } } })),
  });
  assert.deepEqual(await client.query("query { viewer { id } }"), { viewer: { id: "u" } });
  assert.equal(sent.url, "https://api.test/graphql");
  assert.equal(sent.init.headers.authorization, "Bearer a1");
  assert.deepEqual(JSON.parse(sent.init.body), { query: "query { viewer { id } }", variables: {} });
});

test("concurrent queries share one refresh", async () => {
  const store = memoryStore(expiring);
  let refreshes = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, { access_token: "a2", refresh_token: "r2", expires_in: 86400 });
      }
      assert.equal(init.headers.authorization, "Bearer a2");
      return json(200, { data: {} });
    },
  });
  await Promise.all([client.query("q"), client.query("q")]);
  assert.equal(refreshes, 1);
  assert.equal(store.saved.refreshToken, "r2");
  assert.deepEqual(store.saved.viewer, fresh.viewer);
});

test("an offline refresh keeps the token", async () => {
  const store = memoryStore(expiring);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  await assert.rejects(client.query("q"), { code: "offline" });
  assert.deepEqual(store.saved, expiring);
  assert.equal(revoked, 0);
});

test("a revoked refresh clears the token and reports it", async () => {
  const store = memoryStore(expiring);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async () => json(400, { error: "invalid_grant" }),
  });
  await assert.rejects(client.query("q"), { code: "not-connected", message: "Linear isn't connected." });
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a 401 from GraphQL clears the token and reports it", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async () => json(401, {}),
  });
  await assert.rejects(client.query("q"), { code: "not-connected", message: "Linear isn't connected." });
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a refresh without a new refresh token keeps the old one", async () => {
  const store = memoryStore(expiring);
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async (url) => (url.endsWith("/oauth/token") ? json(200, { access_token: "a2", expires_in: 86400 }) : json(200, { data: {} })),
  });
  await client.query("q");
  assert.equal(store.saved.accessToken, "a2");
  assert.equal(store.saved.refreshToken, "r1");
});

test("rate limits and GraphQL errors surface as messages", async () => {
  const limited = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(200, { errors: [{ message: "x", extensions: { code: "RATELIMITED" } }] }),
  });
  await assert.rejects(limited.query("q"), { code: "rate-limited", message: "Linear is limiting requests. Try again in a minute." });
  const broken = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(200, { errors: [{ message: "Field 'x' doesn't exist" }] }),
  });
  await assert.rejects(broken.query("q"), { code: "failed", message: "Field 'x' doesn't exist" });
  const empty = createLinearClient({ store: memoryStore(null), clientId: "cid", apiBase: "https://api.test", fetchImpl: async () => json(200, {}) });
  await assert.rejects(empty.query("q"), { code: "not-connected" });
});

test("a 401 on a fresh token refreshes once and retries", async () => {
  const store = memoryStore(fresh);
  let refreshes = 0;
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        refreshes++;
        return json(200, { access_token: "a2", refresh_token: "r2", expires_in: 86400 });
      }
      return init.headers.authorization === "Bearer a1" ? json(401, {}) : json(200, { data: { ok: 1 } });
    },
  });
  assert.deepEqual(await client.query("q"), { ok: 1 });
  assert.equal(refreshes, 1);
  assert.equal(store.saved.accessToken, "a2");
  assert.equal(revoked, 0);
});

test("a 401 that survives the forced refresh signs out once", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async (url) => (url.endsWith("/oauth/token") ? json(200, { access_token: "a2", expires_in: 86400 }) : json(401, {})),
  });
  await assert.rejects(client.query("q"), { code: "not-connected" });
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a 401 whose forced refresh is revoked signs out", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async (url) => (url.endsWith("/oauth/token") ? json(400, { error: "invalid_grant" }) : json(401, {})),
  });
  await assert.rejects(client.query("q"), { code: "not-connected" });
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a late 401 keeps a token rotated during the request and retries with it", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  let calls = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async (url, init) => {
      calls++;
      if (init.headers.authorization === "Bearer a1") {
        store.saveToken({ ...fresh, accessToken: "a2", refreshToken: "r2" });
        return json(401, {});
      }
      return json(200, { data: { ok: 2 } });
    },
  });
  assert.deepEqual(await client.query("q"), { ok: 2 });
  assert.equal(store.saved.accessToken, "a2");
  assert.equal(revoked, 0);
  assert.equal(calls, 2);
});

test("concurrent 401s on one token sign out and call revoked once", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    revoked: () => revoked++,
    fetchImpl: async (url) => {
      if (!url.endsWith("/oauth/token")) return json(401, {});
      await new Promise((resolve) => setTimeout(resolve, 10));
      return json(200, { access_token: "a2", expires_in: 86400 });
    },
  });
  const results = await Promise.allSettled([client.query("q"), client.query("q")]);
  assert.deepEqual(
    results.map((result) => result.reason?.code),
    ["not-connected", "not-connected"],
  );
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a GraphQL 5xx reads as offline", async () => {
  const client = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(503, { errors: [{ message: "upstream" }] }),
  });
  await assert.rejects(client.query("q"), { code: "offline", message: "Linear is having trouble. Try again in a minute." });
});

test("a JSON null or non-object body is treated as an empty answer", async () => {
  const ok = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(200, null),
  });
  assert.equal(await ok.query("q"), undefined);
  const text = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(200, "oops"),
  });
  assert.equal(await text.query("q"), undefined);
  const failed = createLinearClient({
    store: memoryStore(fresh),
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async () => json(400, null),
  });
  await assert.rejects(failed.query("q"), { code: "failed", message: "Linear answered 400." });
});

test("a failed token save after refresh is a LinearError", async () => {
  const store = memoryStore(expiring);
  store.saveToken = () => {
    throw new Error("disk full");
  };
  const client = createLinearClient({
    store,
    clientId: "cid",
    apiBase: "https://api.test",
    now: () => 1000,
    fetchImpl: async (url) => (url.endsWith("/oauth/token") ? json(200, { access_token: "a2", expires_in: 86400 }) : json(200, { data: {} })),
  });
  await assert.rejects(client.query("q"), (error) => {
    assert.equal(error.name, "LinearError");
    assert.equal(error.code, "failed");
    assert.equal(error.message, "Couldn't save the Linear sign-in: disk full");
    return true;
  });
});
