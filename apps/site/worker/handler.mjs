export const RELEASES_API = "https://api.github.com/repos/the-ptf/milagre-ade/releases/latest";
export const RELEASES_PAGE = "https://github.com/the-ptf/milagre-ade/releases/latest";
export const REPO_API = "https://api.github.com/repos/the-ptf/milagre-ade";

// Release assets carry the version in their names, so match by pattern.
const TARGETS = {
  "mac-arm64": /^Milagre-.+-arm64\.dmg$/,
  "mac-x64": /^Milagre-.+-x64\.dmg$/,
};

function githubInit(token, timeoutMs) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "milagre-site" };
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, signal: AbortSignal.timeout(timeoutMs) };
}

export async function latestDownload(target, fetchImpl, { token, timeoutMs = 3000 } = {}) {
  const pattern = TARGETS[target];
  if (!pattern) return null;
  try {
    const response = await fetchImpl(RELEASES_API, githubInit(token, timeoutMs));
    if (!response.ok) return RELEASES_PAGE;
    const release = await response.json();
    const asset = (release.assets || []).find((item) => pattern.test(item.name));
    return asset ? asset.browser_download_url : RELEASES_PAGE;
  } catch {
    return RELEASES_PAGE;
  }
}

// The star count for the nav pill, or null when GitHub can't be reached.
export async function repoStars(fetchImpl, { token, timeoutMs = 3000 } = {}) {
  try {
    const response = await fetchImpl(REPO_API, githubInit(token, timeoutMs));
    if (!response.ok) return null;
    const repo = await response.json();
    return Number.isInteger(repo.stargazers_count) ? repo.stargazers_count : null;
  } catch {
    return null;
  }
}

export async function handleRequest(request, { assets, fetchImpl, token }) {
  const url = new URL(request.url);
  if (url.hostname === "www.milagre.cloud") {
    url.hostname = "milagre.cloud";
    return Response.redirect(url.toString(), 301);
  }
  const download = url.pathname.match(/^\/download\/([a-z0-9-]+)\/?$/);
  if (download) {
    const location = await latestDownload(download[1], fetchImpl, { token });
    if (!location) return new Response("Unknown download", { status: 404 });
    return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
  }
  if (url.pathname === "/api/stars") {
    const stars = await repoStars(fetchImpl, { token });
    return Response.json({ stars }, { headers: { "cache-control": stars === null ? "no-store" : "public, max-age=600" } });
  }
  return assets.fetch(request);
}
