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

  async function cancelPending() {
    const current = pending;
    current.cancel();
    await current.done.catch(() => {});
    if (pending === current) pending = null;
  }

  function status() {
    const token = store.readToken();
    return token ? { connected: true, viewer: token.viewer, organization: token.organization } : { connected: false };
  }

  // Best effort: a token Linear can't be told about is gone from this Mac either way.
  const revoke = (token, hint) => revokeToken({ fetchImpl, apiBase, token, hint });

  async function signIn(attempt) {
    const pkce = createPkce();
    const state = crypto.randomBytes(16).toString("hex");
    const callback = await listenForCallback({ state, port, timeoutMs });
    attempt.callback = callback;
    try {
      if (attempt.cancelled) throw new LinearError("Replaced by a newer Linear sign-in.", "cancelled");
      openBrowser(authorizeUrl({ clientId, redirectUri: callback.redirectUri, state, challenge: pkce.challenge }));
      const code = await callback.code;
      const replaced = () => new LinearError("Replaced by a newer Linear sign-in.", "cancelled");
      if (attempt.cancelled) throw replaced();
      const tokens = await exchangeCode({ fetchImpl, apiBase, clientId, code, redirectUri: callback.redirectUri, verifier: pkce.verifier, now: now() });
      try {
        // The exchange and the Viewer query are awaits too: a sign-in cancelled during them must not save a token.
        if (attempt.cancelled) throw replaced();
        const { viewer, organization } = await postGraphql({ fetchImpl, apiBase, accessToken: tokens.accessToken, query: VIEWER });
        if (attempt.cancelled) throw replaced();
        store.saveToken({
          ...tokens,
          viewer: { name: viewer.name, email: viewer.email },
          organization: { name: organization.name, urlKey: organization.urlKey },
        });
      } catch (error) {
        // Linear already issued a grant; without a saved token nothing here could ever end it.
        await revoke(tokens.refreshToken, "refresh_token");
        throw error.code === "cancelled" ? error : new LinearError(`Linear sign-in failed: ${error.message}`, "failed");
      }
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
      // Newest call wins: with several in a row, each one cancels whichever registered last, until none is left.
      while (pending) await cancelPending();
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
      // Revoking the refresh token ends the whole grant; the access token is only a fallback if Linear refused that.
      if (!(await revoke(token.refreshToken, "refresh_token"))) await revoke(token.accessToken, "access_token");
      return status();
    },
    async dispose() {
      while (pending) await cancelPending();
    },
    enabled: () => store.readEnabled(),
    setEnabled: (value) => store.saveEnabled(value),
  };
}

module.exports = { createLinear };
