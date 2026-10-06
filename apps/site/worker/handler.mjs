export const RELEASES_API = "https://api.github.com/repos/the-ptf/milagre-ade/releases/latest";
export const RELEASES_PAGE = "https://github.com/the-ptf/milagre-ade/releases/latest";

// Release assets carry the version in their names, so match by pattern.
const TARGETS = {
  "mac-arm64": /^Milagre-.+-arm64\.dmg$/,
  "mac-x64": /^Milagre-.+-x64\.dmg$/,
};

export async function latestDownload(target, fetchImpl) {
  const pattern = TARGETS[target];
  if (!pattern) return null;
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "milagre-site" },
    });
    if (!response.ok) return RELEASES_PAGE;
    const release = await response.json();
    const asset = (release.assets || []).find(item => pattern.test(item.name));
    return asset ? asset.browser_download_url : RELEASES_PAGE;
  } catch {
    return RELEASES_PAGE;
  }
}

export async function handleRequest(request, { assets, fetchImpl }) {
  const url = new URL(request.url);
  if (url.hostname === "www.milagre.cloud") {
    url.hostname = "milagre.cloud";
    return Response.redirect(url.toString(), 301);
  }
  const download = url.pathname.match(/^\/download\/([a-z0-9-]+)\/?$/);
  if (download) {
    const location = await latestDownload(download[1], fetchImpl);
    if (!location) return new Response("Unknown download", { status: 404 });
    return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
  }
  return assets.fetch(request);
}
