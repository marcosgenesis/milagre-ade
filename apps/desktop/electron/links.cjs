// Links in agent replies open in the user's browser. The app window itself never navigates away from Milagre.
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function externalUrl(url) {
  try {
    const parsed = new URL(url);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

// The dev server is matched by origin; a packaged build loads one file, matched by path.
function isAppUrl(url, appUrl) {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return app.protocol === "file:" ? target.protocol === "file:" && target.pathname === app.pathname : target.origin === app.origin;
  } catch {
    return false;
  }
}

function guardNavigation(webContents, { appUrl, openExternal }) {
  const leave = (url) => {
    const target = externalUrl(url);
    if (target) openExternal(target);
  };
  webContents.setWindowOpenHandler(({ url }) => {
    leave(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url, appUrl)) return;
    event.preventDefault();
    leave(url);
  });
}

module.exports = { externalUrl, guardNavigation };
