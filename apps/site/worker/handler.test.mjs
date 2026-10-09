import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASES_API, RELEASES_PAGE, REPO_API, handleRequest, latestDownload, repoStars } from "./handler.mjs";

const release = {
  tag_name: "v0.92.0",
  assets: [
    { name: "Milagre-0.92.0-arm64.dmg.blockmap", browser_download_url: "https://example.test/arm64.dmg.blockmap" },
    { name: "Milagre-0.92.0-arm64.zip", browser_download_url: "https://example.test/arm64.zip" },
    { name: "Milagre-0.92.0-arm64.dmg", browser_download_url: "https://example.test/arm64.dmg" },
    { name: "Milagre-0.92.0-x64.dmg.blockmap", browser_download_url: "https://example.test/x64.dmg.blockmap" },
    { name: "Milagre-0.92.0-x64.dmg", browser_download_url: "https://example.test/x64.dmg" },
  ],
};

function github(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const assets = { fetch: async (request) => new Response(`asset ${new URL(request.url).pathname}`) };

test("resolves the Apple Silicon DMG, never its blockmap or zip", async () => {
  const { fetchImpl, calls } = github(release);
  assert.equal(await latestDownload("mac-arm64", fetchImpl), "https://example.test/arm64.dmg");
  assert.equal(calls[0].url, RELEASES_API);
  assert.equal(calls[0].init.headers["user-agent"], "milagre-site");
});

test("resolves the Intel DMG", async () => {
  const { fetchImpl } = github(release);
  assert.equal(await latestDownload("mac-x64", fetchImpl), "https://example.test/x64.dmg");
});

test("gives the GitHub request an abort signal so a stalled API cannot hang the redirect", async () => {
  const { fetchImpl, calls } = github(release);
  await latestDownload("mac-arm64", fetchImpl);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("falls back to the releases page when the GitHub request is aborted", async () => {
  const aborted = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  assert.equal(await latestDownload("mac-arm64", aborted, { timeoutMs: 1 }), RELEASES_PAGE);
});

test("sends a bearer token to GitHub when one is configured", async () => {
  const { fetchImpl, calls } = github(release);
  await latestDownload("mac-arm64", fetchImpl, { token: "ghp_test" });
  assert.equal(calls[0].init.headers.authorization, "Bearer ghp_test");
});

test("sends no authorization header without a token", async () => {
  const { fetchImpl, calls } = github(release);
  await latestDownload("mac-arm64", fetchImpl);
  assert.equal("authorization" in calls[0].init.headers, false);
});

test("handleRequest forwards the token to the GitHub lookup", async () => {
  const { fetchImpl, calls } = github(release);
  await handleRequest(new Request("https://milagre.cloud/download/mac-arm64"), { assets, fetchImpl, token: "ghp_test" });
  assert.equal(calls[0].init.headers.authorization, "Bearer ghp_test");
});

test("returns null for an unknown target without calling GitHub", async () => {
  const { fetchImpl, calls } = github(release);
  assert.equal(await latestDownload("windows", fetchImpl), null);
  assert.equal(calls.length, 0);
});

test("falls back to the releases page when GitHub rate-limits", async () => {
  const { fetchImpl } = github({ message: "API rate limit exceeded" }, 403);
  assert.equal(await latestDownload("mac-arm64", fetchImpl), RELEASES_PAGE);
});

test("falls back to the releases page when the fetch throws", async () => {
  assert.equal(
    await latestDownload("mac-arm64", async () => {
      throw new Error("offline");
    }),
    RELEASES_PAGE,
  );
});

test("falls back to the releases page when the release has no DMG for that arch", async () => {
  const { fetchImpl } = github({ assets: [{ name: "Milagre-0.93.0-x64.exe", browser_download_url: "https://example.test/x64.exe" }] });
  assert.equal(await latestDownload("mac-arm64", fetchImpl), RELEASES_PAGE);
});

test("/download/mac-arm64 redirects with 302 and no caching", async () => {
  const { fetchImpl } = github(release);
  const response = await handleRequest(new Request("https://milagre.cloud/download/mac-arm64"), { assets, fetchImpl });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.test/arm64.dmg");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("/download/<unknown> is a 404", async () => {
  const { fetchImpl } = github(release);
  const response = await handleRequest(new Request("https://milagre.cloud/download/linux"), { assets, fetchImpl });
  assert.equal(response.status, 404);
});

test("www redirects permanently to the apex, keeping path and query", async () => {
  const { fetchImpl } = github(release);
  const response = await handleRequest(new Request("https://www.milagre.cloud/download/mac-x64?ref=x"), { assets, fetchImpl });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://milagre.cloud/download/mac-x64?ref=x");
});

test("every other path is served from static assets", async () => {
  const { fetchImpl, calls } = github(release);
  const response = await handleRequest(new Request("https://milagre.cloud/"), { assets, fetchImpl });
  assert.equal(await response.text(), "asset /");
  assert.equal(calls.length, 0);
});

test("reads the star count from the repository", async () => {
  const { fetchImpl, calls } = github({ stargazers_count: 1234 });
  assert.equal(await repoStars(fetchImpl), 1234);
  assert.equal(calls[0].url, REPO_API);
});

test("serves the star count as JSON and caches it", async () => {
  const { fetchImpl } = github({ stargazers_count: 42 });
  const response = await handleRequest(new Request("https://milagre.cloud/api/stars"), { assets, fetchImpl });
  assert.deepEqual(await response.json(), { stars: 42 });
  assert.equal(response.headers.get("cache-control"), "public, max-age=600");
});

test("serves null stars without caching when GitHub fails", async () => {
  const { fetchImpl } = github({ message: "rate limited" }, 403);
  const response = await handleRequest(new Request("https://milagre.cloud/api/stars"), { assets, fetchImpl });
  assert.deepEqual(await response.json(), { stars: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
