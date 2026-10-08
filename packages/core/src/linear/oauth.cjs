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
    if (response.status === 429) throw new LinearError("Linear is limiting requests. Try again in a minute.", "rate-limited");
    if (response.status >= 500) throw new LinearError("Linear is having trouble. Try again in a minute.", "offline");
    const message = body.error_description || body.error || `Linear answered ${response.status}.`;
    // Only a refresh that Linear refuses means the grant is gone and only signing in again helps.
    // A failed code exchange is a failed sign-in, whatever the error says.
    const refused = body.error === "invalid_grant" || response.status === 401;
    const revoked = params.grant_type === "refresh_token" && refused;
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
