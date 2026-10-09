const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { createPkce, authorizeUrl, listenForCallback, exchangeCode, refreshTokens, revokeToken } = require("./oauth.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("the PKCE challenge is the base64url SHA-256 of the verifier", () => {
  const { verifier, challenge } = createPkce(() => Buffer.alloc(32, 7));
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
});

test("the authorize URL asks for read access with PKCE", () => {
  const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1/linear/callback", state: "s", challenge: "c" }));
  assert.equal(url.origin + url.pathname, "https://linear.app/oauth/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "cid",
    redirect_uri: "http://127.0.0.1:1/linear/callback",
    response_type: "code",
    scope: "read",
    state: "s",
    code_challenge: "c",
    code_challenge_method: "S256",
    prompt: "consent",
  });
});

test("the callback resolves the code and ignores other paths", async () => {
  const callback = await listenForCallback({ state: "right", port: 0 });
  try {
    assert.match(callback.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/linear\/callback$/);
    assert.equal((await fetch(callback.redirectUri.replace("/linear/callback", "/favicon.ico"))).status, 404);
    const page = await fetch(`${callback.redirectUri}?code=abc&state=right`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<h1>Signed in to Linear<\/h1>/);
    assert.equal(await callback.code, "abc");
  } finally {
    await callback.close();
  }
});

test("a wrong state is refused without ending the wait", async () => {
  const callback = await listenForCallback({ state: "right", port: 0 });
  try {
    assert.equal((await fetch(`${callback.redirectUri}?code=old&state=stale`)).status, 400);
    await fetch(`${callback.redirectUri}?code=new&state=right`);
    assert.equal(await callback.code, "new");
  } finally {
    await callback.close();
  }
});

test("Linear's error on the callback fails the sign-in with its message", async () => {
  const callback = await listenForCallback({ state: "s", port: 0 });
  try {
    await fetch(`${callback.redirectUri}?error=access_denied&error_description=User%20cancelled&state=s`);
    await assert.rejects(callback.code, { code: "failed", message: "Linear sign-in failed: User cancelled" });
  } finally {
    await callback.close();
  }
});

test("the wait times out and cancel rejects at once", async () => {
  const slow = await listenForCallback({ state: "s", port: 0, timeoutMs: 20 });
  await assert.rejects(slow.code, { code: "failed", message: "Linear sign-in timed out. Try again." });
  await slow.close();
  const replaced = await listenForCallback({ state: "s", port: 0 });
  await replaced.cancel();
  await assert.rejects(replaced.code, { code: "cancelled" });
});

test("a taken port says so", async () => {
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const { port } = blocker.address();
  try {
    await assert.rejects(listenForCallback({ state: "s", port }), { message: `Port ${port} is in use. Close the app using it and try again.` });
  } finally {
    blocker.close();
  }
});

test("the code exchange posts the verifier and returns when the token expires", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400, token_type: "Bearer", scope: "read" });
  };
  const tokens = await exchangeCode({
    fetchImpl,
    apiBase: "https://api.test",
    clientId: "cid",
    code: "abc",
    redirectUri: "http://127.0.0.1:1/linear/callback",
    verifier: "v",
    now: 1000,
  });
  assert.deepEqual(tokens, { accessToken: "a1", refreshToken: "r1", expiresAt: 1000 + 86_400_000 });
  assert.equal(sent.url, "https://api.test/oauth/token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.init.body)), {
    grant_type: "authorization_code",
    code: "abc",
    redirect_uri: "http://127.0.0.1:1/linear/callback",
    client_id: "cid",
    code_verifier: "v",
  });
});

test("an invalid_grant refresh is revoked, a network error is offline", async () => {
  await assert.rejects(
    refreshTokens({ fetchImpl: async () => json(400, { error: "invalid_grant" }), apiBase: "https://api.test", clientId: "cid", refreshToken: "r", now: 0 }),
    { code: "revoked" },
  );
  await assert.rejects(
    refreshTokens({
      fetchImpl: async () => {
        throw new Error("ENOTFOUND");
      },
      apiBase: "https://api.test",
      clientId: "cid",
      refreshToken: "r",
      now: 0,
    }),
    { code: "offline", message: "Couldn't reach Linear: ENOTFOUND" },
  );
});

test("a failed code exchange is failed, never revoked, even on invalid_grant", async () => {
  await assert.rejects(
    exchangeCode({
      fetchImpl: async () => json(400, { error: "invalid_grant" }),
      apiBase: "https://api.test",
      clientId: "cid",
      code: "abc",
      redirectUri: "http://127.0.0.1:1/linear/callback",
      verifier: "v",
      now: 0,
    }),
    { code: "failed", message: "Linear sign-in failed: invalid_grant" },
  );
});

test("a refresh rejected for rate limiting says to try again later", async () => {
  await assert.rejects(
    refreshTokens({ fetchImpl: async () => json(429, { error: "rate_limited" }), apiBase: "https://api.test", clientId: "cid", refreshToken: "r", now: 0 }),
    { code: "rate-limited", message: "Linear is limiting requests. Try again in a minute." },
  );
});

test("a refresh met by a Linear server error is offline, not revoked", async () => {
  await assert.rejects(refreshTokens({ fetchImpl: async () => json(503, {}), apiBase: "https://api.test", clientId: "cid", refreshToken: "r", now: 0 }), {
    code: "offline",
    message: "Linear is having trouble. Try again in a minute.",
  });
});

test("a refresh posts the refresh token and returns the new one Linear sends back", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return json(200, { access_token: "a2", refresh_token: "r2", expires_in: 86400 });
  };
  const tokens = await refreshTokens({ fetchImpl, apiBase: "https://api.test", clientId: "cid", refreshToken: "r1", now: 1000 });
  assert.deepEqual(tokens, { accessToken: "a2", refreshToken: "r2", expiresAt: 1000 + 86_400_000 });
  assert.equal(sent.url, "https://api.test/oauth/token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.init.body)), {
    grant_type: "refresh_token",
    refresh_token: "r1",
    client_id: "cid",
  });
});

test("revoking posts only the token and its type hint, with no client_id and no authorization header", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => (sent.push({ url, init }), json(200, { success: true }));
  assert.equal(await revokeToken({ fetchImpl, apiBase: "https://api.test", token: "r1", hint: "refresh_token" }), true);
  assert.equal(await revokeToken({ fetchImpl, apiBase: "https://api.test", token: "a1", hint: "access_token" }), true);
  assert.equal(sent[0].url, "https://api.test/oauth/revoke");
  assert.equal(sent[0].init.method, "POST");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent[0].init.body)), { token: "r1", token_type_hint: "refresh_token" });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent[1].init.body)), { token: "a1", token_type_hint: "access_token" });
  for (const { init } of sent) {
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers["content-type"] ?? init.headers["Content-Type"], "application/x-www-form-urlencoded");
  }
});

test("revoking reports whether Linear accepted it, and never throws", async () => {
  const args = { apiBase: "https://api.test", token: "r1", hint: "refresh_token" };
  assert.equal(await revokeToken({ ...args, fetchImpl: async () => json(400, {}) }), false);
  assert.equal(await revokeToken({ ...args, fetchImpl: async () => json(500, {}) }), false);
  assert.equal(
    await revokeToken({
      ...args,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    false,
  );
});
