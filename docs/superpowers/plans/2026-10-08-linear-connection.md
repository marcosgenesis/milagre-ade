# Linear connection (PR 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac can connect to and disconnect from a Linear workspace over OAuth, behind a daemon-stored Experimental toggle, with the status shown in desktop and phone Settings.

**Architecture:** A new `packages/core/src/linear/` folder holds the OAuth PKCE flow (a one-shot loopback callback server), a private token file, a GraphQL client that refreshes tokens, and a `createLinear` facade the runtime turns into `linear:*` commands. Desktop reaches the commands through the preload bridge; phones reach the read-only ones through the mobile bridge allowlist and re-read on focus.

**Tech Stack:** Node 24 CommonJS in core and daemon (`node:test`, global `fetch`, `node:http`), React + Tailwind in the Electron renderer, Expo / React Native on the phone, shared TS copy in `@milagre/shared`.

**Spec:** `docs/superpowers/specs/2026-10-08-linear-integration-design.md` (sections Connection, Errors, Testing, Delivery item 1).

## Global Constraints

- OAuth: PKCE `S256`, no client secret, `scope=read`, `prompt=consent`. Authorize `https://linear.app/oauth/authorize`; token `<apiBase>/oauth/token`; revoke `<apiBase>/oauth/revoke`; GraphQL `<apiBase>/graphql`. `apiBase` defaults to `https://api.linear.app` and is overridden by `MILAGRE_LINEAR_API`.
- Callback: `http://127.0.0.1:47615/linear/callback`, listening on `127.0.0.1` only, waiting at most 5 minutes (`300_000` ms).
- Client id: `BUILT_IN_CLIENT_ID` in `packages/core/src/linear/config.cjs`, overridden by `MILAGRE_LINEAR_CLIENT_ID`. Victor sends the id after registering the app; until then `linear:connect` fails with "Linear sign-in isn't set up in this build."
- Token refresh happens when the access token expires within 5 minutes (`300_000` ms). Linear rotates the refresh token on every use.
- Files: `<dataDir>/linear/token.json` and `<dataDir>/linear/settings.json`, folder 0700 via `preparePrivateDirectory`, files written 0600 with temp + rename.
- Commands: `linear:status`, `linear:connect`, `linear:disconnect`, `linear:enabled:read`, `linear:enabled:save`. Event: `linear:status-changed` with the new status as payload.
- Phones: `linear:status` and `linear:enabled:read` allowed; `linear:enabled:save` allowed but denied when confined; `linear:connect` and `linear:disconnect` not allowed.
- Copy, verbatim: title "Linear"; hint "Start chats from Linear issues and see each Worktree's issue."; connected "Connected as {viewer.name} to {organization.name}"; disconnected on the Mac "Not connected"; disconnected on a phone "Connect Linear from Settings on your Mac"; connecting "Finish signing in to Linear in your browser."
- Desktop and phone ship together. Mobile is JS only: no fingerprint change, ships as OTA.
- No `Co-Authored-By` or "Generated with" lines in commits or the PR body.

## Review Focus

1. User closes the browser tab and clicks Connect again: the new attempt starts at once on the same port instead of failing for 5 minutes (Task 4, "a second connect replaces the first").
2. Two Linear calls at once near token expiry: exactly one refresh request, because a second one would use a refresh token Linear already rotated (Task 3, "concurrent queries share one refresh").
3. A network failure during refresh: the token stays and the Mac stays connected; only `invalid_grant` or a 401 disconnects (Task 3, "an offline refresh keeps the token").
4. A stale browser tab hits the callback with an old `state`: the request is refused and the live attempt keeps waiting (Task 2, "a wrong state is refused without ending the wait").
5. Port 47615 already taken by another app: Connect fails with "Port 47615 is in use. Close the app using it and try again." (Task 2, "a taken port says so").

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/linear.ts` (create) | `LinearStatus` type and the copy both platforms show |
| `packages/shared/src/linear.test.ts` (create) | Copy tests |
| `packages/core/src/linear/errors.cjs` (create) | `LinearError` with a `code` |
| `packages/core/src/linear/config.cjs` (create) | Client id, API base, callback port |
| `packages/core/src/linear/oauth.cjs` (create) | PKCE, authorize URL, callback server, token exchange, refresh, revoke |
| `packages/core/src/linear/store.cjs` (create) | Token and settings files |
| `packages/core/src/linear/client.cjs` (create) | GraphQL POST and the refreshing client |
| `packages/core/src/linear/index.cjs` (create) | `createLinear`: status, connect, disconnect, enabled |
| `packages/core/src/linear/*.test.cjs` (create) | Unit tests per module |
| `packages/core/src/runtime.cjs` (modify, near line 846) | `linear:*` commands and the event |
| `packages/core/src/runtime.d.cts` (modify) | `linear` runtime option |
| `packages/core/src/runtime.test.cjs` (modify) | Commands end to end against fakes |
| `apps/daemon/src/mobile-bridge.cjs` (modify, line 37) | Phone allowlist |
| `apps/daemon/src/confine.cjs` (modify, line 94) | Confinement rules |
| `apps/daemon/src/confine.test.cjs` (modify, after line 572) | Confined phone can read, not save |
| `apps/desktop/electron/preload.cjs` (modify, after line 102) | Bridge methods |
| `apps/desktop/app/src/electron.d.ts` (modify) | Bridge types |
| `apps/desktop/app/src/components/Settings.tsx` (modify) | `LinearSettings` inside Experimental |
| `scripts/test-linear-settings.cjs` (create) | Electron check |
| `apps/mobile/src/app/settings.tsx` (modify) | Beta card with toggle and status |

---

### Task 1: Shared Linear copy

**Files:**
- Create: `packages/shared/src/linear.ts`
- Create: `packages/shared/src/linear.test.ts`
- Modify: `packages/shared/package.json` (`files` array after `"src/main-sync.ts",` and `exports` after `"./main-sync": "./src/main-sync.ts",`)

**Interfaces:**
- Produces: `type LinearStatus`, `LINEAR_TITLE`, `LINEAR_HINT`, `LINEAR_CONNECTING`, `linearStatusLine(status: LinearStatus, where: "mac" | "phone"): string`, importable as `@milagre/shared/linear`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/linear.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { linearStatusLine, type LinearStatus } from "./linear.ts";

const connected: LinearStatus = {
  connected: true,
  viewer: { name: "Victor", email: "victor@example.com" },
  organization: { name: "Acme", urlKey: "acme" },
};

test("a connected status names the user and the workspace on both platforms", () => {
  assert.equal(linearStatusLine(connected, "mac"), "Connected as Victor to Acme");
  assert.equal(linearStatusLine(connected, "phone"), "Connected as Victor to Acme");
});

test("a disconnected phone is told to connect on the Mac", () => {
  assert.equal(linearStatusLine({ connected: false }, "mac"), "Not connected");
  assert.equal(linearStatusLine({ connected: false }, "phone"), "Connect Linear from Settings on your Mac");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test packages/shared/src/linear.test.ts`
Expected: FAIL, cannot find module `./linear.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/linear.ts
// Linear connection copy, shared by desktop and phone (see docs/superpowers/specs/2026-10-08-linear-integration-design.md).

export type LinearViewer = { name: string; email: string };
export type LinearOrganization = { name: string; urlKey: string };
export type LinearStatus = { connected: false } | { connected: true; viewer: LinearViewer; organization: LinearOrganization };

export const LINEAR_TITLE = "Linear";
export const LINEAR_HINT = "Start chats from Linear issues and see each Worktree's issue.";
export const LINEAR_CONNECTING = "Finish signing in to Linear in your browser.";

/** Connecting happens on the Mac only, so a disconnected phone points there. */
export function linearStatusLine(status: LinearStatus, where: "mac" | "phone"): string {
  if (status.connected) return `Connected as ${status.viewer.name} to ${status.organization.name}`;
  return where === "mac" ? "Not connected" : "Connect Linear from Settings on your Mac";
}
```

In `packages/shared/package.json` add `"src/linear.ts",` after `"src/main-sync.ts",` in `files`, and `"./linear": "./src/linear.ts",` after `"./main-sync": "./src/main-sync.ts",` in `exports`.

- [ ] **Step 4: Run it to see it pass**

Run: `node --test packages/shared/src/linear.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/linear.ts packages/shared/src/linear.test.ts packages/shared/package.json
git commit -m "feat(shared): Linear connection copy"
```

---

### Task 2: OAuth flow

**Files:**
- Create: `packages/core/src/linear/errors.cjs`
- Create: `packages/core/src/linear/config.cjs`
- Create: `packages/core/src/linear/oauth.cjs`
- Test: `packages/core/src/linear/oauth.test.cjs`

**Interfaces:**
- Produces:
  - `class LinearError extends Error { code: "not-configured" | "not-connected" | "cancelled" | "offline" | "rate-limited" | "revoked" | "failed" }`
  - `CLIENT_ID: string`, `API_BASE: string`, `CALLBACK_PORT: 47615`
  - `createPkce(random?) → { verifier, challenge }`
  - `authorizeUrl({ clientId, redirectUri, state, challenge }) → string`
  - `listenForCallback({ state, port?, timeoutMs? }) → Promise<{ redirectUri, code: Promise<string>, close(): Promise<void>, cancel(): Promise<void> }>`
  - `exchangeCode({ fetchImpl, apiBase, clientId, code, redirectUri, verifier, now }) → Promise<{ accessToken, refreshToken, expiresAt }>`
  - `refreshTokens({ fetchImpl, apiBase, clientId, refreshToken, now }) → Promise<{ accessToken, refreshToken, expiresAt }>`
  - `revokeToken({ fetchImpl, apiBase, accessToken }) → Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/src/linear/oauth.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { createPkce, authorizeUrl, listenForCallback, exchangeCode, refreshTokens } = require("./oauth.cjs");

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
  const tokens = await exchangeCode({ fetchImpl, apiBase: "https://api.test", clientId: "cid", code: "abc", redirectUri: "http://127.0.0.1:1/linear/callback", verifier: "v", now: 1000 });
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
    refreshTokens({ fetchImpl: async () => { throw new Error("ENOTFOUND"); }, apiBase: "https://api.test", clientId: "cid", refreshToken: "r", now: 0 }),
    { code: "offline", message: "Couldn't reach Linear: ENOTFOUND" },
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test packages/core/src/linear/oauth.test.cjs`
Expected: FAIL, cannot find module `./oauth.cjs`.

- [ ] **Step 3: Implement**

```js
// packages/core/src/linear/errors.cjs
/** A Linear failure the UI can show as is. `code` says what the caller should do about it. */
class LinearError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "LinearError";
    this.code = code;
  }
}

module.exports = { LinearError };
```

```js
// packages/core/src/linear/config.cjs
// The "Milagre" OAuth app in Linear (Settings › API › OAuth applications). PKCE, so no secret ships with the app.
const BUILT_IN_CLIENT_ID = "";

module.exports = {
  CLIENT_ID: process.env.MILAGRE_LINEAR_CLIENT_ID || BUILT_IN_CLIENT_ID,
  // Tests point this at a local mock of Linear.
  API_BASE: process.env.MILAGRE_LINEAR_API || "https://api.linear.app",
  // Registered as the app's callback URL, so it can't move.
  CALLBACK_PORT: 47615,
};
```

```js
// packages/core/src/linear/oauth.cjs
const crypto = require("node:crypto");
const http = require("node:http");
const { LinearError } = require("./errors.cjs");

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const CALLBACK_PATH = "/linear/callback";
const FORM = { "content-type": "application/x-www-form-urlencoded" };

function createPkce(random = crypto.randomBytes) {
  const verifier = random(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

const page = (text) =>
  `<!doctype html><meta charset="utf-8"><title>Milagre</title><body style="font:15px -apple-system,sans-serif;padding:48px">${text}</body>`;

// One sign-in's callback: a loopback server that takes the first request carrying the right state, then closes.
async function listenForCallback({ state, port = 47615, timeoutMs = 300_000 }) {
  let settle;
  const code = new Promise((resolve, reject) => (settle = { resolve, reject }));
  code.catch(() => {});
  const server = http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const answer = (status, text) => response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(text));
    const params = url.searchParams;
    // A stale tab from an earlier attempt: refuse it, keep waiting for this one.
    if (params.get("state") !== state) return answer(400, "This sign-in link is out of date. Start again from Milagre.");
    if (params.get("error")) {
      answer(200, "Linear sign-in was cancelled. You can close this tab.");
      settle.reject(new LinearError(`Linear sign-in failed: ${params.get("error_description") || params.get("error")}`, "failed"));
      return;
    }
    const value = params.get("code");
    if (!value) return answer(400, "Linear didn't send a sign-in code. Start again from Milagre.");
    answer(200, "Return to Milagre to finish connecting. You can close this tab.");
    settle.resolve(value);
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(error.code === "EADDRINUSE" ? new LinearError(`Port ${port} is in use. Close the app using it and try again.`, "failed") : error),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  const timer = setTimeout(() => settle.reject(new LinearError("Linear sign-in timed out. Try again.", "failed")), timeoutMs);
  timer.unref();
  let closed = null;
  const close = () =>
    (closed ??= new Promise((resolve) => {
      clearTimeout(timer);
      server.close(() => resolve());
      server.closeAllConnections();
    }));
  return {
    redirectUri: `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`,
    code,
    close,
    cancel() {
      settle.reject(new LinearError("Replaced by a newer Linear sign-in.", "cancelled"));
      return close();
    },
  };
}

async function tokenRequest({ fetchImpl, apiBase, params, now }) {
  let response;
  try {
    response = await fetchImpl(`${apiBase}/oauth/token`, {
      method: "POST",
      headers: FORM,
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new LinearError(`Couldn't reach Linear: ${error.message}`, "offline");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") {
    const message = body.error_description || body.error || `Linear answered ${response.status}.`;
    // invalid_grant: the refresh token was revoked or already used. Only signing in again helps.
    const revoked = body.error === "invalid_grant" || response.status === 401;
    throw new LinearError(`Linear sign-in failed: ${message}`, revoked ? "revoked" : "failed");
  }
  // A refresh answer without a new refresh token leaves the old one in place.
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : params.refresh_token;
  return { accessToken: body.access_token, refreshToken, expiresAt: now + Number(body.expires_in ?? 86_400) * 1000 };
}

function exchangeCode({ fetchImpl, apiBase, clientId, code, redirectUri, verifier, now }) {
  const params = { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier };
  return tokenRequest({ fetchImpl, apiBase, params, now });
}

function refreshTokens({ fetchImpl, apiBase, clientId, refreshToken, now }) {
  return tokenRequest({ fetchImpl, apiBase, params: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }, now });
}

async function revokeToken({ fetchImpl, apiBase, accessToken }) {
  await fetchImpl(`${apiBase}/oauth/revoke`, {
    method: "POST",
    headers: { ...FORM, authorization: `Bearer ${accessToken}` },
    body: new URLSearchParams({ token: accessToken }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
}

module.exports = { createPkce, authorizeUrl, listenForCallback, exchangeCode, refreshTokens, revokeToken };
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test packages/core/src/linear/oauth.test.cjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/linear/errors.cjs packages/core/src/linear/config.cjs packages/core/src/linear/oauth.cjs packages/core/src/linear/oauth.test.cjs
git commit -m "feat(core): Linear OAuth with PKCE and a loopback callback"
```

---

### Task 3: Token store and refreshing client

**Files:**
- Create: `packages/core/src/linear/store.cjs`
- Create: `packages/core/src/linear/client.cjs`
- Test: `packages/core/src/linear/store.test.cjs`
- Test: `packages/core/src/linear/client.test.cjs`

**Interfaces:**
- Consumes: `LinearError`, `refreshTokens` from Task 2.
- Produces:
  - `createLinearStore({ dataDir }) → { readToken(): Token | null, saveToken(token), clearToken(), readEnabled(): boolean, saveEnabled(value): boolean }`, where `Token = { accessToken, refreshToken, expiresAt, viewer: { name, email }, organization: { name, urlKey } }`
  - `postGraphql({ fetchImpl, apiBase, accessToken, query, variables? }) → Promise<data>`
  - `createLinearClient({ store, clientId, apiBase, fetchImpl?, now?, revoked? }) → { query(document, variables?) → Promise<data> }`

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/src/linear/store.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLinearStore } = require("./store.cjs");

const token = { accessToken: "a", refreshToken: "r", expiresAt: 5, viewer: { name: "V", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } };

test("the token is saved owner-only and read back, then cleared", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  assert.equal(store.readToken(), null);
  store.saveToken(token);
  assert.deepEqual(store.readToken(), token);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dataDir, "linear", "token.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dataDir, "linear")).mode & 0o777, 0o700);
  }
  store.clearToken();
  assert.equal(store.readToken(), null);
});

test("a corrupt or incomplete token file reads as not connected", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  store.saveToken({ accessToken: "a" });
  assert.equal(store.readToken(), null);
  fs.writeFileSync(path.join(dataDir, "linear", "token.json"), "{", { mode: 0o600 });
  assert.equal(store.readToken(), null);
});

test("the Experimental switch is off until saved on", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  assert.equal(store.readEnabled(), false);
  assert.equal(store.saveEnabled(true), true);
  assert.equal(createLinearStore({ dataDir }).readEnabled(), true);
  assert.equal(store.saveEnabled("yes"), false);
});
```

```js
// packages/core/src/linear/client.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLinearClient } = require("./client.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function memoryStore(token) {
  let saved = token;
  return { readToken: () => saved, saveToken: (next) => (saved = next), clearToken: () => (saved = null), get saved() { return saved; } };
}
const fresh = { accessToken: "a1", refreshToken: "r1", expiresAt: 10_000_000, viewer: { name: "V", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } };
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
  const client = createLinearClient({ store, clientId: "cid", apiBase: "https://api.test", now: () => 1000, revoked: () => revoked++, fetchImpl: async () => json(400, { error: "invalid_grant" }) });
  await assert.rejects(client.query("q"), { code: "not-connected", message: "Linear isn't connected." });
  assert.equal(store.saved, null);
  assert.equal(revoked, 1);
});

test("a 401 from GraphQL clears the token and reports it", async () => {
  const store = memoryStore(fresh);
  let revoked = 0;
  const client = createLinearClient({ store, clientId: "cid", apiBase: "https://api.test", now: () => 1000, revoked: () => revoked++, fetchImpl: async () => json(401, {}) });
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
  const limited = createLinearClient({ store: memoryStore(fresh), clientId: "cid", apiBase: "https://api.test", now: () => 1000, fetchImpl: async () => json(200, { errors: [{ message: "x", extensions: { code: "RATELIMITED" } }] }) });
  await assert.rejects(limited.query("q"), { code: "rate-limited", message: "Linear is limiting requests. Try again in a minute." });
  const broken = createLinearClient({ store: memoryStore(fresh), clientId: "cid", apiBase: "https://api.test", now: () => 1000, fetchImpl: async () => json(200, { errors: [{ message: "Field 'x' doesn't exist" }] }) });
  await assert.rejects(broken.query("q"), { code: "failed", message: "Field 'x' doesn't exist" });
  const empty = createLinearClient({ store: memoryStore(null), clientId: "cid", apiBase: "https://api.test", fetchImpl: async () => json(200, {}) });
  await assert.rejects(empty.query("q"), { code: "not-connected" });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test packages/core/src/linear/store.test.cjs packages/core/src/linear/client.test.cjs`
Expected: FAIL, cannot find modules `./store.cjs` and `./client.cjs`.

- [ ] **Step 3: Implement**

```js
// packages/core/src/linear/store.cjs
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { preparePrivateDirectory } = require("../private-files.cjs");

// The Mac's Linear sign-in and the Experimental switch, owner-only like the provider accounts (accounts.cjs).
function createLinearStore({ dataDir }) {
  const root = path.join(dataDir, "linear");
  const tokenFile = path.join(root, "token.json");
  const settingsFile = path.join(root, "settings.json");
  function read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }
  function write(file, value) {
    preparePrivateDirectory(root);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  return {
    readToken() {
      const token = read(tokenFile);
      const valid = token && typeof token.accessToken === "string" && typeof token.refreshToken === "string" && Number.isFinite(token.expiresAt);
      return valid ? token : null;
    },
    saveToken: (token) => write(tokenFile, token),
    clearToken: () => fs.rmSync(tokenFile, { force: true }),
    readEnabled: () => read(settingsFile)?.enabled === true,
    saveEnabled(value) {
      write(settingsFile, { enabled: value === true });
      return value === true;
    },
  };
}

module.exports = { createLinearStore };
```

```js
// packages/core/src/linear/client.cjs
const { LinearError } = require("./errors.cjs");
const { refreshTokens } = require("./oauth.cjs");

const REFRESH_MARGIN_MS = 5 * 60_000;
const notConnected = () => new LinearError("Linear isn't connected.", "not-connected");

async function postGraphql({ fetchImpl, apiBase, accessToken, query, variables = {} }) {
  let response;
  try {
    response = await fetchImpl(`${apiBase}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new LinearError(`Couldn't reach Linear: ${error.message}`, "offline");
  }
  if (response.status === 401) throw new LinearError("Linear isn't connected.", "revoked");
  const body = await response.json().catch(() => ({}));
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (response.status === 429 || errors.some((error) => error?.extensions?.code === "RATELIMITED"))
    throw new LinearError("Linear is limiting requests. Try again in a minute.", "rate-limited");
  if (!response.ok || errors.length) throw new LinearError(errors[0]?.message || `Linear answered ${response.status}.`, "failed");
  return body.data;
}

// Queries as the connected user, refreshing the access token shortly before it expires.
function createLinearClient({ store, clientId, apiBase, fetchImpl = globalThis.fetch, now = Date.now, revoked = () => {} }) {
  let refreshing = null;
  function signOut() {
    store.clearToken();
    revoked();
    return notConnected();
  }
  async function refresh(saved) {
    try {
      const next = { ...saved, ...(await refreshTokens({ fetchImpl, apiBase, clientId, refreshToken: saved.refreshToken, now: now() })) };
      store.saveToken(next);
      return next;
    } catch (error) {
      // Offline or Linear down: keep the token and try again on the next call.
      if (error.code === "revoked") throw signOut();
      throw error;
    }
  }
  async function current() {
    const saved = store.readToken();
    if (!saved) throw notConnected();
    if (saved.expiresAt - now() > REFRESH_MARGIN_MS) return saved;
    // Linear rotates the refresh token on every use, so concurrent callers share one refresh.
    refreshing ??= refresh(saved).finally(() => (refreshing = null));
    return refreshing;
  }
  return {
    async query(document, variables) {
      const { accessToken } = await current();
      try {
        return await postGraphql({ fetchImpl, apiBase, accessToken, query: document, variables });
      } catch (error) {
        if (error.code === "revoked") throw signOut();
        throw error;
      }
    },
  };
}

module.exports = { postGraphql, createLinearClient };
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test packages/core/src/linear/store.test.cjs packages/core/src/linear/client.test.cjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/linear/store.cjs packages/core/src/linear/client.cjs packages/core/src/linear/store.test.cjs packages/core/src/linear/client.test.cjs
git commit -m "feat(core): Linear token store and refreshing GraphQL client"
```

---

### Task 4: `createLinear` and the runtime commands

**Files:**
- Create: `packages/core/src/linear/index.cjs`
- Test: `packages/core/src/linear/index.test.cjs`
- Modify: `packages/core/src/runtime.cjs` (require block near line 35; commands after line 846)
- Modify: `packages/core/src/runtime.d.cts` (`RuntimeOptions`, after `readPullRequest?`)
- Modify: `packages/core/src/runtime.test.cjs` (new test at the end)

**Interfaces:**
- Consumes: everything from Tasks 2 and 3; `openInBrowser(url)` from `packages/core/src/antigravity-account.cjs` (exported at line 205).
- Produces:
  - `createLinear({ dataDir, clientId?, apiBase?, port?, timeoutMs?, fetchImpl?, openBrowser?, now?, changed? }) → { status(), connect(), disconnect(), enabled(), setEnabled(value), query(document, variables?) }`. `status()` returns `LinearStatus` from Task 1. Later PRs call `query`.
  - Runtime commands `linear:status`, `linear:connect`, `linear:disconnect`, `linear:enabled:read → { enabled }`, `linear:enabled:save(value) → { enabled }`; event `linear:status-changed` with a `LinearStatus` payload.
  - `RuntimeOptions.linear?: { clientId?, apiBase?, port?, timeoutMs?, fetchImpl?, openBrowser? }`.

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/src/linear/index.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLinear } = require("./index.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A fake Linear: the token endpoint, the viewer query and revoke. The browser "approves" by calling the callback.
function fakeLinear() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/oauth/token")) return json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400 });
    if (url.endsWith("/oauth/revoke")) return json(200, {});
    return json(200, { data: { viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } } });
  };
  const approve = (url) => {
    const params = new URL(url).searchParams;
    void fetch(`${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`);
  };
  return { calls, fetchImpl, approve };
}

function setup(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const linear = fakeLinear();
  let changes = 0;
  const service = createLinear({ dataDir, clientId: "cid", apiBase: "https://api.test", port: 0, fetchImpl: linear.fetchImpl, openBrowser: linear.approve, changed: () => changes++, ...overrides });
  return { service, linear, changes: () => changes };
}

test("connect signs in through the browser and saves who connected", async (t) => {
  const { service, changes } = setup(t);
  assert.deepEqual(service.status(), { connected: false });
  const status = await service.connect();
  assert.deepEqual(status, { connected: true, viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } });
  assert.deepEqual(service.status(), status);
  assert.equal(changes(), 1);
});

test("disconnect forgets the token even when the revoke fails", async (t) => {
  const linear = fakeLinear();
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/oauth/revoke")) throw new Error("offline");
    return linear.fetchImpl(url, init);
  };
  const { service, changes } = setup(t, { fetchImpl, openBrowser: linear.approve });
  await service.connect();
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.deepEqual(service.status(), { connected: false });
  assert.equal(changes(), 2);
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.equal(changes(), 2, "disconnecting when already disconnected changes nothing");
});

test("a second connect replaces the first", async (t) => {
  let opened = 0;
  const { service, linear } = setup(t, {
    openBrowser: (url) => {
      opened++;
      if (opened === 2) linear.approve(url);
    },
  });
  const first = service.connect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = service.connect();
  await assert.rejects(first, { code: "cancelled" });
  assert.equal((await second).connected, true);
  assert.equal(opened, 2);
});

test("connect without a client id says the build isn't set up", async (t) => {
  const { service } = setup(t, { clientId: "" });
  await assert.rejects(service.connect(), { code: "not-configured", message: "Linear sign-in isn't set up in this build." });
});

test("the Experimental switch round-trips", async (t) => {
  const { service } = setup(t);
  assert.equal(service.enabled(), false);
  assert.equal(service.setEnabled(true), true);
  assert.equal(service.enabled(), true);
});
```

Add to the end of `packages/core/src/runtime.test.cjs` (it reuses the file's `fixture(t)`):

```js
test("linear commands connect, report and disconnect, and emit the status", async (t) => {
  const { make, events } = await fixture(t);
  const json = (status, body) => ({ ok: true, status, json: async () => body });
  const runtime = make({
    linear: {
      clientId: "cid",
      apiBase: "https://api.test",
      port: 0,
      fetchImpl: async (url) =>
        url.endsWith("/oauth/token")
          ? json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400 })
          : json(200, { data: { viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } } }),
      openBrowser: (url) => {
        const params = new URL(url).searchParams;
        void fetch(`${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`);
      },
    },
  });
  assert.deepEqual(await runtime.invoke("linear:status"), { connected: false });
  assert.deepEqual(await runtime.invoke("linear:enabled:read"), { enabled: false });
  assert.deepEqual(await runtime.invoke("linear:enabled:save", [true]), { enabled: true });
  const connected = await runtime.invoke("linear:connect");
  assert.equal(connected.connected, true);
  assert.deepEqual(events.filter((event) => event.channel === "linear:status-changed").map((event) => event.payload), [connected]);
  assert.deepEqual(await runtime.invoke("linear:disconnect"), { connected: false });
  assert.deepEqual(events.filter((event) => event.channel === "linear:status-changed").at(-1).payload, { connected: false });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test packages/core/src/linear/index.test.cjs` then `node --test --test-name-pattern="linear commands" packages/core/src/runtime.test.cjs`
Expected: FAIL, cannot find module `./index.cjs`; the runtime test fails with "Unknown command: linear:status".

- [ ] **Step 3: Implement**

```js
// packages/core/src/linear/index.cjs
const crypto = require("node:crypto");
const { openInBrowser } = require("../antigravity-account.cjs");
const { CLIENT_ID, API_BASE, CALLBACK_PORT } = require("./config.cjs");
const { LinearError } = require("./errors.cjs");
const { createPkce, authorizeUrl, listenForCallback, exchangeCode, revokeToken } = require("./oauth.cjs");
const { createLinearStore } = require("./store.cjs");
const { postGraphql, createLinearClient } = require("./client.cjs");

const VIEWER = "query Viewer { viewer { name email } organization { name urlKey } }";

// The Mac's one Linear connection (see docs/superpowers/specs/2026-10-08-linear-integration-design.md).
function createLinear({
  dataDir,
  clientId = CLIENT_ID,
  apiBase = API_BASE,
  port = CALLBACK_PORT,
  timeoutMs,
  fetchImpl = globalThis.fetch,
  openBrowser = openInBrowser,
  now = Date.now,
  changed = () => {},
}) {
  const store = createLinearStore({ dataDir });
  const client = createLinearClient({ store, clientId, apiBase, fetchImpl, now, revoked: changed });
  let pending = null;

  function status() {
    const token = store.readToken();
    return token ? { connected: true, viewer: token.viewer, organization: token.organization } : { connected: false };
  }

  async function signIn(attempt) {
    const pkce = createPkce();
    const state = crypto.randomBytes(16).toString("hex");
    const callback = await listenForCallback({ state, port, timeoutMs });
    attempt.callback = callback;
    try {
      if (attempt.cancelled) throw new LinearError("Replaced by a newer Linear sign-in.", "cancelled");
      openBrowser(authorizeUrl({ clientId, redirectUri: callback.redirectUri, state, challenge: pkce.challenge }));
      const code = await callback.code;
      const tokens = await exchangeCode({ fetchImpl, apiBase, clientId, code, redirectUri: callback.redirectUri, verifier: pkce.verifier, now: now() });
      const { viewer, organization } = await postGraphql({ fetchImpl, apiBase, accessToken: tokens.accessToken, query: VIEWER });
      store.saveToken({ ...tokens, viewer: { name: viewer.name, email: viewer.email }, organization: { name: organization.name, urlKey: organization.urlKey } });
    } finally {
      await callback.close();
    }
    changed();
    return status();
  }

  return {
    status,
    query: client.query,
    async connect() {
      if (!clientId) throw new LinearError("Linear sign-in isn't set up in this build.", "not-configured");
      // A second Connect replaces the first: the user may have closed the browser tab, and the callback port is fixed.
      if (pending) {
        pending.cancel();
        await pending.done.catch(() => {});
      }
      const attempt = { cancelled: false, callback: null };
      const done = signIn(attempt);
      pending = {
        done,
        cancel() {
          attempt.cancelled = true;
          void attempt.callback?.cancel();
        },
      };
      try {
        return await done;
      } finally {
        if (pending?.done === done) pending = null;
      }
    },
    async disconnect() {
      const token = store.readToken();
      store.clearToken();
      if (!token) return status();
      changed();
      // Best effort: the token is gone from this Mac whether or not Linear hears about it.
      await revokeToken({ fetchImpl, apiBase, accessToken: token.accessToken }).catch(() => {});
      return status();
    },
    enabled: () => store.readEnabled(),
    setEnabled: (value) => store.saveEnabled(value),
  };
}

module.exports = { createLinear };
```

In `packages/core/src/runtime.cjs`, add with the other requires near line 35:

```js
const { createLinear } = require("./linear/index.cjs");
```

and after `commands.handle("accounts:list", ...)` (line 846) and the accounts mutation loop that follows it:

```js
  // The Mac's Linear connection. Phones read it and the Experimental switch; only the Mac connects (mobile-bridge.cjs).
  const linear = createLinear({ dataDir, ...options.linear, changed: () => emit("linear:status-changed", linear.status()) });
  commands.handle("linear:status", () => linear.status());
  commands.handle("linear:connect", () => linear.connect());
  commands.handle("linear:disconnect", () => linear.disconnect());
  commands.handle("linear:enabled:read", () => ({ enabled: linear.enabled() }));
  commands.handle("linear:enabled:save", (_event, value) => ({ enabled: linear.setEnabled(value === true) }));
```

In `packages/core/src/runtime.d.cts`, inside `RuntimeOptions` after `readPullRequest?`:

```ts
  /** The Linear connection; tests point it at a fake Linear and a fake browser. */
  linear?: {
    clientId?: string;
    apiBase?: string;
    port?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    openBrowser?: (url: string) => void;
  };
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test packages/core/src/linear/index.test.cjs` and `node --test --test-name-pattern="linear commands" packages/core/src/runtime.test.cjs`
Expected: PASS, 5 tests and 1 test.

- [ ] **Step 5: Run the core suite**

Run: `npm test -- --unit --workspace core`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/linear/index.cjs packages/core/src/linear/index.test.cjs packages/core/src/runtime.cjs packages/core/src/runtime.d.cts packages/core/src/runtime.test.cjs
git commit -m "feat(core): linear:* commands to connect a Mac to Linear"
```

---

### Task 5: Phone access to Linear status

**Files:**
- Modify: `apps/daemon/src/mobile-bridge.cjs:37` (`METHODS`)
- Modify: `apps/daemon/src/confine.cjs:94` (`PATHS`)
- Test: `apps/daemon/src/confine.test.cjs` (after line 572)

**Interfaces:**
- Consumes: the Task 4 command names.
- Produces: phones may call `linear:status`, `linear:enabled:read`, `linear:enabled:save` (the last refused when confined).

- [ ] **Step 1: Write the failing test**

After the main sync default test in `apps/daemon/src/confine.test.cjs`:

```js
// Linear is the Mac's connection: a confined phone sees whether it is on and connected, and changes nothing.
test("a confined phone reads Linear status and the switch but can't change it", async () => {
  const confine = createConfinement({ allowedRoot: os.tmpdir() });
  await confine.checkCall("linear:status", []);
  await confine.checkCall("linear:enabled:read", []);
  await assert.rejects(confine.checkCall("linear:enabled:save", [true]), { status: 403, message: REFUSED });
});

test("phones can't connect or disconnect Linear", () => {
  assert.equal(METHODS.has("linear:connect"), false);
  assert.equal(METHODS.has("linear:disconnect"), false);
});
```

If `METHODS` is not already imported at the top of the test file, add it to the existing `require("./mobile-bridge.cjs")` destructuring.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test apps/daemon/src/confine.test.cjs`
Expected: FAIL on the first new test (no rule for `linear:status`).

- [ ] **Step 3: Implement**

In `apps/daemon/src/mobile-bridge.cjs`, after `"main-sync:default:save",`:

```js
  "linear:status",
  "linear:enabled:read",
  "linear:enabled:save",
```

In `apps/daemon/src/confine.cjs`, after `"main-sync:default:save": denied,`:

```js
  // The Mac's Linear connection names no folder. A confined phone reads it; the switch reaches every Project, so it can't flip it.
  "linear:status": none,
  "linear:enabled:read": none,
  "linear:enabled:save": denied,
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test apps/daemon/src/confine.test.cjs`
Expected: PASS, including the METHODS/PATHS parity test at line 166.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/mobile-bridge.cjs apps/daemon/src/confine.cjs apps/daemon/src/confine.test.cjs
git commit -m "feat(daemon): phones read Linear status and its Experimental switch"
```

---

### Task 6: Desktop Settings

**Files:**
- Modify: `apps/desktop/electron/preload.cjs` (after `onMainSyncStatus`, about line 102)
- Modify: `apps/desktop/app/src/electron.d.ts` (import at line 1; members next to `onMainSyncStatus`)
- Modify: `apps/desktop/app/src/components/Settings.tsx` (`ExperimentalSettings`, line 189; new `LinearSettings` after `MainSyncDefaultSetting`)
- Create: `scripts/test-linear-settings.cjs`

**Interfaces:**
- Consumes: Task 1 copy and `LinearStatus`; Task 4 commands and event.
- Produces: `window.milagre.readLinearStatus`, `connectLinear`, `disconnectLinear`, `readLinearEnabled`, `saveLinearEnabled`, `onLinearStatusChanged`; DOM hooks `[data-linear-settings]` with `data-linear-connected="true|false"`.

- [ ] **Step 1: Write the failing Electron check**

Copy `scripts/test-experimental-settings.cjs` to `scripts/test-linear-settings.cjs`, then change:

1. The header comment to `// Settings > Experimental > Linear in Electron: the switch reveals the connection, which connects and disconnects.`
2. The fixture to:

```js
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsNav, SettingsPanel } from '/src/components/Settings';
import '/src/styles.css';
let enabled = false;
let status = { connected: false };
const listeners = new Set();
const connected = { connected: true, viewer: { name: 'Victor', email: 'v@x' }, organization: { name: 'Acme', urlKey: 'acme' } };
window.milagre = {
  listEditors: async () => [], listRecentProjects: async () => [], listProjects: async () => [],
  readLinearEnabled: async () => ({ enabled }),
  saveLinearEnabled: async (value) => ({ enabled: (enabled = value) }),
  readLinearStatus: async () => status,
  connectLinear: () => new Promise((resolve) => setTimeout(() => resolve((status = connected)), 300)),
  disconnectLinear: async () => (status = { connected: false }),
  onLinearStatusChanged: (callback) => (listeners.add(callback), () => listeners.delete(callback)),
};
function Fixture() {
  const [section, setSection] = useState('appearance');
  return (
    <div style={{ display: 'flex', gap: 12, height: '100vh', padding: 12 }}>
      <SettingsNav section={section} onSelect={setSection} onSelectProject={() => {}} onBack={() => {}} showProjectSettings={false} />
      <main style={{ flex: 1, minWidth: 0 }}><SettingsPanel section={section} models={[]} update={null} /></main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;
```

3. The `try` block of `browserChecks` to:

```js
  const toggle = `document.querySelector('[role="switch"][aria-label="Linear"]')`;
  const button = (label) => `[...document.querySelectorAll('[data-linear-settings] button')].find(b => b.textContent.trim() === '${label}')`;
  const text = `document.querySelector('[data-linear-settings]').textContent`;
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Experimental')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Experimental').click()`);
    await waitFor(`!!${toggle}`);
    assert.equal(await evaluate(`!!${button("Connect")}`), false, "Connection hidden while the switch is off");
    await screenshot("off");
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!${button("Connect")}`);
    assert.match(await evaluate(text), /Not connected/);
    await screenshot("not-connected");
    await evaluate(`${button("Connect")}.click()`);
    await waitFor(`${text}.includes('Finish signing in to Linear in your browser.')`);
    assert.equal(await evaluate(`!!${button("Start again")}`), true);
    await screenshot("connecting");
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'true'`);
    assert.match(await evaluate(text), /Connected as Victor to Acme/);
    await screenshot("connected");
    await evaluate(`${button("Disconnect")}.click()`);
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'false'`);
    assert.deepEqual(errors, []);
    console.log("PASS: Experimental > Linear shows the connection only when on, connects through the browser and disconnects");
    app.exit(0);
  } catch (error) {
```

4. Every `experimental-settings` string in `main()` (cache dir, plugin name, virtual module id and URL path) to `linear-settings`, and the `mkdtempSync` prefix to `milagre-linear-settings-`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- --only linear-settings`
Expected: FAIL, "Timed out" waiting for the `Linear` switch.

- [ ] **Step 3: Implement the bridge**

`apps/desktop/electron/preload.cjs`, after `onMainSyncStatus`:

```js
  readLinearStatus: () => ipcRenderer.invoke("linear:status"),
  connectLinear: () => ipcRenderer.invoke("linear:connect"),
  disconnectLinear: () => ipcRenderer.invoke("linear:disconnect"),
  readLinearEnabled: () => ipcRenderer.invoke("linear:enabled:read"),
  saveLinearEnabled: (value) => ipcRenderer.invoke("linear:enabled:save", value),
  onLinearStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("linear:status-changed", listener);
    return () => ipcRenderer.removeListener("linear:status-changed", listener);
  },
```

`apps/desktop/app/src/electron.d.ts`: add `import type { LinearStatus } from "@milagre/shared/linear";` below line 1, and next to `onMainSyncStatus`:

```ts
        readLinearStatus: () => Promise<LinearStatus>;
        /** Opens Linear in the browser and resolves once the Mac is connected. A second call replaces a waiting one. */
        connectLinear: () => Promise<LinearStatus>;
        disconnectLinear: () => Promise<LinearStatus>;
        readLinearEnabled: () => Promise<{ enabled: boolean }>;
        saveLinearEnabled: (value: boolean) => Promise<{ enabled: boolean }>;
        onLinearStatusChanged: (callback: (status: LinearStatus) => void) => () => void;
```

- [ ] **Step 4: Implement the Settings UI**

In `apps/desktop/app/src/components/Settings.tsx`, add to the imports:

```tsx
import { LINEAR_CONNECTING, LINEAR_HINT, LINEAR_TITLE, linearStatusLine, type LinearStatus } from "@milagre/shared/linear";
```

(add `useRef` to the existing `react` import if it isn't there). Change `ExperimentalSettings` to render `<LinearSettings />` as the second child of its `Group`, after the every-project `Row`. Add after `MainSyncDefaultSetting`:

```tsx
// Experimental > Linear: the daemon keeps the switch (phones share it) and the Mac's one connection.
function LinearSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<LinearStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Connect again replaces a waiting sign-in; only the latest attempt may update the row.
  const attempt = useRef(0);
  useEffect(() => {
    let live = true;
    // Started inside a promise so a bridge without the command (an older host) reads as off instead of throwing.
    Promise.resolve()
      .then(() => window.milagre.readLinearEnabled())
      .then(
        (value) => live && setEnabled(value?.enabled === true),
        () => live && setEnabled(false),
      );
    Promise.resolve()
      .then(() => window.milagre.readLinearStatus())
      .then(
        (value) => live && setStatus(value),
        () => live && setStatus({ connected: false }),
      );
    const stop = window.milagre.onLinearStatusChanged?.((next) => live && setStatus(next));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  async function changeEnabled(next: boolean) {
    setError(null);
    setEnabled(next);
    try {
      setEnabled((await window.milagre.saveLinearEnabled(next)).enabled);
    } catch (failure) {
      setEnabled(!next);
      setError(ipcErrorMessage(failure));
    }
  }
  async function connect() {
    const id = ++attempt.current;
    setError(null);
    setConnecting(true);
    try {
      const next = await window.milagre.connectLinear();
      if (id === attempt.current) setStatus(next);
    } catch (failure) {
      if (id === attempt.current) setError(ipcErrorMessage(failure));
    } finally {
      if (id === attempt.current) setConnecting(false);
    }
  }
  async function disconnect() {
    setError(null);
    try {
      setStatus(await window.milagre.disconnectLinear());
    } catch (failure) {
      setError(ipcErrorMessage(failure));
    }
  }
  return (
    <div data-linear-settings data-linear-connected={status?.connected ? "true" : "false"} className="divide-y divide-line">
      <Row label={LINEAR_TITLE} description={LINEAR_HINT}>
        <Switch label={LINEAR_TITLE} checked={enabled === true} onChange={(next) => void changeEnabled(next)} />
      </Row>
      {enabled && status && (
        <Row label={linearStatusLine(status, "mac")} description={connecting ? LINEAR_CONNECTING : undefined}>
          {status.connected ? (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => void connect()}>
              {connecting ? "Start again" : "Connect"}
            </button>
          )}
        </Row>
      )}
      {error && <p className="px-4 pb-3 break-words text-[12px] text-red">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Run the check to see it pass**

Run: `MILAGRE_SCREENSHOT_DIR=$TMPDIR/linear-settings npm test -- --only linear-settings`
Expected: `PASS: Experimental > Linear shows the connection only when on, connects through the browser and disconnects`, with four PNGs in `$TMPDIR/linear-settings`. Also run `npm test -- --only experimental-settings` to confirm the every-project switch still passes.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/app/src/electron.d.ts apps/desktop/app/src/components/Settings.tsx scripts/test-linear-settings.cjs
git commit -m "feat(desktop): connect Linear from Settings › Experimental"
```

---

### Task 7: Phone Settings

**Files:**
- Modify: `apps/mobile/src/app/settings.tsx` (imports at lines 1-12; state after the sync-main state at line 39; a Beta card after the Worktrees card, about line 126)

**Interfaces:**
- Consumes: Task 1 copy; Task 5 phone commands.
- Produces: a "Beta" card with the Linear toggle, the hint, and the status line while on.

- [ ] **Step 1: Implement**

Add to the imports:

```tsx
import { LINEAR_HINT, LINEAR_TITLE, linearStatusLine, type LinearStatus } from "@milagre/shared/linear";
```

Inside `SettingsView`, after the `syncMain` state and its `useFocusEffect`:

```tsx
  // The Mac's Linear switch and connection; null until the Mac answers (an older Mac never does). Re-read on focus:
  // the phone gets no event when the Mac connects or disconnects.
  const [linear, setLinear] = useState<{ enabled: boolean; status: LinearStatus } | null>(null);
  const [linearError, setLinearError] = useState("");
  useFocusEffect(
    useCallback(() => {
      const client = session.client;
      if (!client) return;
      let live = true;
      Promise.all([client.call<{ enabled: boolean }>("linear:enabled:read", []), client.call<LinearStatus>("linear:status", [])]).then(
        ([value, status]) => live && setLinear({ enabled: value.enabled, status }),
        () => live && setLinear(null),
      );
      return () => {
        live = false;
      };
    }, [session.client]),
  );
  async function changeLinear(next: boolean) {
    const client = session.client;
    if (!client || !linear) return;
    setLinearError("");
    setLinear({ ...linear, enabled: next });
    try {
      const { enabled } = await client.call<{ enabled: boolean }>("linear:enabled:save", [next]);
      setLinear((current) => current && { ...current, enabled });
    } catch (failure) {
      setLinear((current) => current && { ...current, enabled: !next });
      setLinearError(failure instanceof Error ? failure.message : "Could not change this setting.");
    }
  }
```

After the Worktrees block (`{session.client && syncMain !== null && (...)}`):

```tsx
      {session.client && linear !== null && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>Beta</Text>
          <View style={[styles.card, { gap: 4 }]}>
            <Toggle title={LINEAR_TITLE} selected={linear.enabled} onPress={() => void changeLinear(!linear.enabled)} />
            <Text style={styles.caption}>{LINEAR_HINT}</Text>
            {linear.enabled && <Text style={styles.caption}>{linearStatusLine(linear.status, "phone")}</Text>}
            {linearError ? <ErrorNotice message={linearError} /> : null}
          </View>
        </>
      )}
```

- [ ] **Step 2: Typecheck, lint, mobile unit tests**

Run: `npm run typecheck && npm run lint && npm test -- --unit --workspace mobile`
Expected: all clean.

- [ ] **Step 3: Check on the simulator**

Following `apps/mobile/AGENTS.md` and the argent rules: run the dev build against a daemon from this branch, open Settings, and confirm the Beta card shows the Linear switch. Turn it on: the status reads "Connect Linear from Settings on your Mac". Connect on the Mac, return to phone Settings: it reads "Connected as … to …". Save screenshots outside the repo for the PR.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/settings.tsx
git commit -m "feat(mobile): Linear switch and connection status in Settings"
```

---

### Task 8: Client id, full checks, PR

**Files:**
- Modify: `packages/core/src/linear/config.cjs` (`BUILT_IN_CLIENT_ID`)

- [ ] **Step 1: Set the client id**

Victor registers the Linear OAuth app (name Milagre, callback `http://127.0.0.1:47615/linear/callback`, Public on) and sends the client id. Set `const BUILT_IN_CLIENT_ID = "<the id Victor sent>";`. If Linear refuses `127.0.0.1` and wants `localhost`, change `redirectUri` in `listenForCallback` to `http://localhost:${port}${CALLBACK_PATH}` (the server still binds `127.0.0.1`) and update the Global Constraints line in this plan and the spec.

- [ ] **Step 2: Real sign-in once**

Run the desktop app from this branch, turn on Experimental › Linear, click Connect, approve in the browser, and confirm "Connected as …". Disconnect and confirm the app disappears from Linear › Settings › Security & access › Authorized applications.

- [ ] **Step 3: Full checks**

Run: `npm run typecheck && npm run lint && npm test -- --unit && npm test -- --only linear-settings && npm test -- --only experimental-settings`
Expected: all pass.

- [ ] **Step 4: Commit, push, PR**

```bash
git add packages/core/src/linear/config.cjs
git commit -m "feat(core): ship the Milagre Linear OAuth client id"
git push -u origin HEAD
```

Push the Task 6 and Task 7 screenshots to the `screenshots` branch under `linear-connection/` (per `AGENTS.md`), then open the PR with `gh pr create`, titled "feat: connect a Mac to Linear from Settings › Experimental, on desktop and phone", linking each image by the screenshots commit SHA. No attribution lines.
