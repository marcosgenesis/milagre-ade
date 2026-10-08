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
