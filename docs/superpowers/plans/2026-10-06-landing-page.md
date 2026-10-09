# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dark, static landing page for Milagre at `milagre.cloud` whose job is macOS downloads, with a scripted Mac + iPhone approval scene in the hero.

**Architecture:** An Astro site in a new `apps/site` workspace builds to `dist/`. A Cloudflare Worker serves that folder as static assets, redirects `www` to the apex and resolves `/download/mac-arm64` and `/download/mac-x64` to the latest GitHub release DMG. A headless Electron check (`scripts/test-site.cjs`) loads the built site at desktop and phone sizes.

**Tech Stack:** Astro 7.3.5, TypeScript, plain CSS (no Tailwind), Cloudflare Workers static assets via wrangler 4.147.0, Node 24 `node:test`, Electron 44 (already a root dev dependency) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-06-landing-page-design.md`

## Global Constraints

- Copy is English and must match the spec verbatim where the spec quotes it. No em dashes or en dashes in any copy.
- Claims are limited to the spec. Never write "end-to-end encrypted" for the phone path: push notifications pass through Expo and Apple.
- No GitHub star count, no tweet wall, no pricing, no waitlist, no analytics.
- Dark only. Colors come from the dark tokens in `apps/desktop/app/src/styles.css`, copied into `apps/site/src/styles/tokens.css`. No hex values in components.
- Fonts: system stack only (`ui-sans-serif, system-ui, -apple-system, sans-serif` and `ui-monospace, "SF Mono", Menlo, monospace`). No font files.
- Download links always go through `/download/mac-arm64` and `/download/mac-x64`; never hardcode a versioned DMG URL.
- Brew command, exactly: `brew install --cask the-ptf/tap/milagre`.
- Requirements, exactly: Claude Code 2.1.288 or newer, Codex CLI 0.160.0 or newer.
- The iPhone link is `IPHONE_BETA_URL` in `apps/site/src/links.ts`. Until a public TestFlight link exists it points to `docs/mobile-local.md` on GitHub.
- Motion respects `prefers-reduced-motion`: the still frame is the default style; animation only runs under `prefers-reduced-motion: no-preference`.
- Do not deploy, create DNS records or touch Cloudflare until Victor explicitly says to (Task 8).
- Commits: conventional messages, no co-author trailers or generated-with footers.

## Review Focus

1. **GitHub API rate limit or outage.** `/download/*` must still send the visitor somewhere useful: a 302 to the releases page. Pinned in Task 2.
2. **A release whose assets do not include a DMG for that arch** (for example a Windows-only release, or names that end in `.dmg.blockmap`). Must fall back, never redirect to a blockmap or zip. Pinned in Task 2.
3. **Phone-width viewport (390 px).** The hero scene and every section must fit with no horizontal scroll. Pinned in Task 3 and rechecked in Task 6.
4. **Reduced motion.** With `prefers-reduced-motion: reduce`, no animation runs and both devices show the approval card. Pinned in Task 4.
5. **Clipboard unavailable** (unfocused window, insecure context, permission denied). The copy button must select the command and tell the visitor to press ⌘C instead of failing silently. Pinned in Task 3.

---

## File structure

```
apps/site/
  package.json              workspace @milagre/site
  astro.config.mjs          static output, site URL
  tsconfig.json             Astro types, excludes worker/
  tsconfig.worker.json      Worker typecheck
  wrangler.toml             Worker + static assets + custom domains
  worker/handler.mjs        request routing: www redirect, /download/*, assets
  worker/handler.d.mts      types for handler.mjs
  worker/handler.test.mjs   node:test for handler.mjs
  worker/worker.ts          Cloudflare entry, wires fetch caching
  src/links.ts              every outbound URL and the brew command
  src/styles/tokens.css     dark tokens copied from the desktop app
  src/styles/global.css     reset, type, layout helpers, buttons
  src/layouts/Base.astro    <head>, SEO and Open Graph tags
  src/components/Nav.astro
  src/components/Footer.astro
  src/components/DownloadButtons.astro
  src/components/CopyCommand.astro
  src/components/Hero.astro
  src/components/PhoneFrame.astro
  src/components/HeroScene.astro
  src/components/Section.astro
  src/components/PhoneChats.astro
  src/components/Faq.astro
  src/pages/index.astro
  src/assets/screenshots/   approval.png, sidebar.png, canvas.png
  public/app-icon.svg
  public/og.png
scripts/fixtures/demo-desktop.cjs   README demo data and fixture, shared
scripts/capture-readme.cjs          now imports the shared fixture
scripts/capture-site.cjs            site screenshots and og.png
scripts/test-site.cjs               headless Electron check of the built site
scripts/monorepo.test.cjs           workspace list gains @milagre/site
package.json                        root scripts for the site
.github/workflows/ci.yml            site worker tests and build
```

---

### Task 1: Scaffold the `apps/site` workspace

**Files:**
- Modify: `scripts/monorepo.test.cjs:11-14`
- Create: `apps/site/package.json`, `apps/site/astro.config.mjs`, `apps/site/tsconfig.json`, `apps/site/src/links.ts`, `apps/site/src/styles/tokens.css`, `apps/site/src/styles/global.css`, `apps/site/src/layouts/Base.astro`, `apps/site/src/components/Nav.astro`, `apps/site/src/components/Footer.astro`, `apps/site/src/pages/index.astro`, `apps/site/public/app-icon.svg`
- Modify: `package.json` (root scripts), `.gitignore`

**Interfaces:**
- Produces: workspace `@milagre/site` with scripts `dev`, `build`, `test`, `typecheck`, `deploy`; root scripts `build:site`, `test:site`, `test:site:worker`, `typecheck:site`, `capture:site`. `src/links.ts` exports `REPO_URL`, `DOCS_URL`, `CHANGELOG_URL`, `DOWNLOAD_ARM64`, `DOWNLOAD_X64`, `BREW_COMMAND`, `IPHONE_BETA_URL`. `Base.astro` takes props `{ title: string; description: string }` and renders a `<slot />` inside `<body>`. Global CSS classes `.container`, `.button`, `.button-primary`, `.muted`, `.eyebrow`.

- [ ] **Step 1: Write the failing test**

In `scripts/monorepo.test.cjs`, change the expected workspace list in the first test to:

```js
  assert.deepEqual(workspaces.map(item => item.name).sort(), ["@milagre/core", "@milagre/daemon", "@milagre/mobile", "@milagre/relay", "@milagre/shared", "@milagre/site", "milagre"]);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test --test-name-pattern="npm discovers" scripts/monorepo.test.cjs`
Expected: FAIL, the actual list is missing `@milagre/site`.

- [ ] **Step 3: Create the workspace package**

`apps/site/package.json`:

```json
{
  "name": "@milagre/site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --host 127.0.0.1 --port 5190",
    "build": "astro check && astro build",
    "test": "node --test worker/*.test.mjs",
    "typecheck": "astro check && tsc -p tsconfig.worker.json",
    "deploy": "npx wrangler@4.147.0 deploy"
  },
  "dependencies": {
    "astro": "7.3.5"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.10",
    "@cloudflare/workers-types": "^5.20261004.1",
    "typescript": "~6.0.3"
  }
}
```

`apps/site/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://milagre.cloud",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
```

`apps/site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "src/**/*"],
  "exclude": ["dist", "worker"]
}
```

Add to the root `.gitignore`:

```
.astro/
```

- [ ] **Step 4: Install and confirm the workspace test passes**

Run: `npm install` then `node --test --test-name-pattern="npm discovers" scripts/monorepo.test.cjs`
Expected: PASS. If `npm install` reports a peer conflict between `@astrojs/check` and `typescript ~6.0.3`, set `typescript` in `apps/site/package.json` to the range `@astrojs/check` names as its peer and install again.

- [ ] **Step 5: Add links, tokens and global styles**

`apps/site/src/links.ts`:

```ts
export const REPO_URL = "https://github.com/the-ptf/milagre-ade";
export const DOCS_URL = `${REPO_URL}/tree/main/docs`;
export const CHANGELOG_URL = `${REPO_URL}/releases`;
export const DOWNLOAD_ARM64 = "/download/mac-arm64";
export const DOWNLOAD_X64 = "/download/mac-x64";
export const BREW_COMMAND = "brew install --cask the-ptf/tap/milagre";
// Replace with the public TestFlight link once the external group has one.
export const IPHONE_BETA_URL = `${REPO_URL}/blob/main/docs/mobile-local.md`;
```

`apps/site/src/styles/tokens.css` (values copied from the `.dark` block of `apps/desktop/app/src/styles.css`):

```css
:root {
  color-scheme: dark;
  --page: oklch(0.209 0.004 264.477);
  --canvas: oklch(0.231 0.004 264.487);
  --surface: oklch(0.26 0.006 271.191);
  --inset: oklch(0.243 0.004 264.492);
  --hover: oklch(0.289 0.006 271.22);
  --hover-2: oklch(0.318 0.007 274.747);
  --ink: oklch(0.964 0.002 247.839);
  --ink-2: oklch(0.731 0.008 260.731);
  --ink-3: oklch(0.541 0.01 264.484);
  --line: oklch(0.308 0.006 258.354);
  --line-strong: oklch(0.356 0.007 264.474);
  --accent: oklch(0.68 0.173 253.301);
  --accent-ink: oklch(0.788 0.113 248.33);
  --accent-tint: oklch(0.68 0.173 253.301 / 0.16);
  --green: oklch(0.705 0.154 153.814);
  --green-tint: oklch(0.705 0.154 153.814 / 0.14);
  --orange: oklch(0.746 0.156 55.642);
  --orange-tint: oklch(0.746 0.156 55.642 / 0.14);
  --shadow-btn: 0 0 0 1px oklch(1 0 0 / 0.1), 0 1px 2px oklch(0 0 0 / 0.3);
  --shadow-card: 0 0 0 1px oklch(1 0 0 / 0.11), 0 1px 2px oklch(0 0 0 / 0.2), 0 2px 6px oklch(0 0 0 / 0.2);
  --shadow-raised: 0 0 0 1px oklch(1 0 0 / 0.13), 0 2px 10px oklch(0 0 0 / 0.22);
  --shadow-overlay: 0 0 0 1px oklch(1 0 0 / 0.15), 0 8px 28px oklch(0 0 0 / 0.34);
  --radius-chip: 6px;
  --radius-control: 8px;
  --radius-card: 10px;
  --radius-window: 14px;
  --ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
  --font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}
```

`apps/site/src/styles/global.css`:

```css
@import "./tokens.css";

*, *::before, *::after { box-sizing: border-box; }
html { background: var(--page); color: var(--ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
body { margin: 0; font-size: 16px; line-height: 1.55; overflow-x: hidden; }
img { max-width: 100%; height: auto; display: block; }
a { color: inherit; }
code, pre { font-family: var(--font-mono); }
h1, h2, h3 { line-height: 1.1; letter-spacing: -0.02em; margin: 0; }
p { margin: 0; }

.container { width: min(1120px, 100% - 40px); margin-inline: auto; }
.muted { color: var(--ink-2); }
.eyebrow { color: var(--accent-ink); font-size: 14px; font-weight: 600; }

.button {
  display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px;
  border-radius: var(--radius-control); background: var(--surface); color: var(--ink);
  box-shadow: var(--shadow-btn); font-weight: 600; text-decoration: none;
  transition: background-color 120ms var(--ease-out-strong), transform 100ms var(--ease-out-strong);
}
.button:hover { background: var(--hover); }
.button:active { transform: scale(0.98); }
.button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.button-primary { background: var(--ink); color: var(--page); }
.button-primary:hover { background: var(--ink-2); }

@media (prefers-reduced-motion: reduce) {
  .button { transition: none; }
}
```

- [ ] **Step 6: Add the layout, nav, footer and a first page**

`apps/site/src/layouts/Base.astro`:

```astro
---
import "../styles/global.css";
interface Props { title: string; description: string }
const { title, description } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site);
const ogImage = new URL("/og.png", Astro.site);
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <link rel="icon" href="/app-icon.svg" type="image/svg+xml" />
    <meta name="color-scheme" content="dark" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <slot />
  </body>
</html>
```

`apps/site/src/components/Nav.astro`:

```astro
---
import { CHANGELOG_URL, DOCS_URL, DOWNLOAD_ARM64, REPO_URL } from "../links";
---
<header class="nav container">
  <a class="brand" href="/" aria-label="Milagre home">
    <img src="/app-icon.svg" alt="" width="28" height="28" />
    <span>Milagre</span>
  </a>
  <nav aria-label="Main">
    <a href={DOCS_URL}>Docs</a>
    <a href={CHANGELOG_URL}>Changelog</a>
    <a href={REPO_URL}>GitHub</a>
    <a class="button button-primary nav-download" href={DOWNLOAD_ARM64}>Download</a>
  </nav>
</header>

<style>
  .nav { display: flex; align-items: center; justify-content: space-between; height: 72px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 18px; text-decoration: none; }
  .brand img { border-radius: 7px; }
  nav { display: flex; align-items: center; gap: 22px; font-size: 15px; }
  nav a:not(.button) { color: var(--ink-2); text-decoration: none; }
  nav a:not(.button):hover { color: var(--ink); }
  .nav-download { height: 36px; padding: 0 14px; }
  @media (max-width: 640px) {
    nav a:not(.button) { display: none; }
  }
</style>
```

`apps/site/src/components/Footer.astro`:

```astro
---
import { CHANGELOG_URL, DOCS_URL, REPO_URL } from "../links";
---
<footer class="footer container">
  <p class="muted">Milagre is free and open source under the MIT license.</p>
  <nav aria-label="Footer">
    <a href={DOCS_URL}>Docs</a>
    <a href={CHANGELOG_URL}>Changelog</a>
    <a href={REPO_URL}>GitHub</a>
  </nav>
</footer>

<style>
  .footer { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; padding: 40px 0 56px; border-top: 1px solid var(--line); font-size: 14px; }
  nav { display: flex; gap: 20px; }
  nav a { color: var(--ink-2); text-decoration: none; }
  nav a:hover { color: var(--ink); }
</style>
```

`apps/site/src/pages/index.astro` (first version; Tasks 3 and 6 fill it in):

```astro
---
import Base from "../layouts/Base.astro";
import Nav from "../components/Nav.astro";
import Footer from "../components/Footer.astro";
const title = "Milagre: run Claude Code and Codex on your Mac, answer from anywhere";
const description = "Milagre runs Claude Code and Codex on your Mac, one Git Worktree per Chat. When an agent needs an approval or an answer, it shows up on your desk and on your iPhone.";
---
<Base title={title} description={description}>
  <Nav />
  <main>
    <h1 class="container">Your agents keep working. Answer them from anywhere.</h1>
  </main>
  <Footer />
</Base>
```

Copy the icon: `cp apps/desktop/app/public/app-icon.svg apps/site/public/app-icon.svg`

- [ ] **Step 7: Add root scripts**

In the root `package.json` `scripts`, add:

```json
"build:site": "npm run build --workspace @milagre/site",
"typecheck:site": "npm run typecheck --workspace @milagre/site",
"test:site:worker": "npm run test --workspace @milagre/site",
"test:site": "node scripts/test-site.cjs",
"capture:site": "node scripts/capture-site.cjs",
```

- [ ] **Step 8: Build and run the workspace contracts**

Run: `npm run build:site && npm run test:monorepo`
Expected: `astro check` reports 0 errors, `apps/site/dist/index.html` exists, monorepo tests PASS.

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json package-lock.json scripts/monorepo.test.cjs apps/site
git commit -m "feat(site): scaffold the Astro landing page workspace"
```

---

### Task 2: Download and redirect Worker

**Files:**
- Create: `apps/site/worker/handler.mjs`, `apps/site/worker/handler.d.mts`, `apps/site/worker/handler.test.mjs`, `apps/site/worker/worker.ts`, `apps/site/tsconfig.worker.json`, `apps/site/wrangler.toml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `DOWNLOAD_ARM64` (`/download/mac-arm64`) and `DOWNLOAD_X64` (`/download/mac-x64`) paths from Task 1.
- Produces: `RELEASES_API: string`, `RELEASES_PAGE: string`, `latestDownload(target: string, fetchImpl: FetchLike): Promise<string | null>`, `handleRequest(request: Request, options: { assets: { fetch(request: Request): Promise<Response> }; fetchImpl: FetchLike }): Promise<Response>`.

- [ ] **Step 1: Write the failing tests**

`apps/site/worker/handler.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASES_API, RELEASES_PAGE, handleRequest, latestDownload } from "./handler.mjs";

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

const assets = { fetch: async request => new Response(`asset ${new URL(request.url).pathname}`) };

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
  assert.equal(await latestDownload("mac-arm64", async () => { throw new Error("offline"); }), RELEASES_PAGE);
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:site:worker`
Expected: FAIL with `Cannot find module` for `./handler.mjs`.

- [ ] **Step 3: Implement the handler**

`apps/site/worker/handler.mjs`:

```js
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
```

`apps/site/worker/handler.d.mts`:

```ts
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare const RELEASES_API: string;
export declare const RELEASES_PAGE: string;
export declare function latestDownload(target: string, fetchImpl: FetchLike): Promise<string | null>;
export declare function handleRequest(
  request: Request,
  options: { assets: { fetch(request: Request): Promise<Response> }; fetchImpl: FetchLike },
): Promise<Response>;
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm run test:site:worker`
Expected: 10 tests PASS.

- [ ] **Step 5: Add the Cloudflare entry and config**

`apps/site/worker/worker.ts`:

```ts
import { handleRequest } from "./handler.mjs";

interface Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      assets: env.ASSETS,
      // Cache the GitHub release lookup at the edge for 5 minutes.
      fetchImpl: (input, init) => fetch(input, { ...init, cf: { cacheTtl: 300, cacheEverything: true } }),
    });
  },
} satisfies ExportedHandler<Env>;
```

`apps/site/tsconfig.worker.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["worker/worker.ts", "worker/*.d.mts"]
}
```

`apps/site/wrangler.toml`:

```toml
name = "milagre-site"
main = "worker/worker.ts"
compatibility_date = "2026-09-01"
routes = [
  { pattern = "milagre.cloud", custom_domain = true },
  { pattern = "www.milagre.cloud", custom_domain = true },
]

[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "404-page"
```

- [ ] **Step 6: Typecheck the Worker**

Run: `npx tsc -p apps/site/tsconfig.worker.json`
Expected: no output, exit 0.

- [ ] **Step 7: Run CI steps for the site**

In `.github/workflows/ci.yml`, after the `Test relay` step, add:

```yaml
      - name: Test site worker
        run: npm run test:site:worker
      - name: Build site
        run: npm run build:site
```

- [ ] **Step 8: Commit**

```bash
git add apps/site/worker apps/site/tsconfig.worker.json apps/site/wrangler.toml .github/workflows/ci.yml
git commit -m "feat(site): resolve macOS downloads from the latest release"
```

---

### Task 3: Hero, download buttons, copy command and the browser check

**Files:**
- Create: `scripts/test-site.cjs`, `apps/site/src/components/DownloadButtons.astro`, `apps/site/src/components/CopyCommand.astro`, `apps/site/src/components/Hero.astro`
- Modify: `apps/site/src/pages/index.astro`

**Interfaces:**
- Consumes: `links.ts` exports from Task 1; `Base`, `Nav`, `Footer`.
- Produces: `scripts/test-site.cjs` with a `checks` array of `{ name, run(open, evaluate, shot) }` entries that later tasks append to. `open(options)` takes `{ width, height, mobile?, reducedMotion? }` and returns an Electron `BrowserWindow` on the built page. `<DownloadButtons />` (no props) and `<CopyCommand command={string} />`. `Hero.astro` renders a `<div class="hero-visual"><slot /></div>` that Task 4 fills with the scene.

- [ ] **Step 1: Write the failing browser check**

`scripts/test-site.cjs`:

```js
// Loads the built landing page in headless Electron at desktop and phone sizes.
// npm run build:site && npm run test:site
// Set MILAGRE_SCREENSHOT_DIR (outside the repo) to save screenshots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const dist = path.resolve(__dirname, "../apps/site/dist");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain" };
const HERO_TITLE = "Your agents keep working. Answer them from anywhere.";
const BREW = "brew install --cask the-ptf/tap/milagre";

function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const checks = [
  {
    name: "desktop hero has the title, both downloads, brew and the iPhone link",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(window, `document.querySelector("h1").textContent.trim()`), HERO_TITLE);
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-arm64"]')`), "Apple Silicon download");
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-x64"]')`), "Intel download");
      assert.equal(await evaluate(window, `document.querySelector(".hero [data-command]").textContent.trim()`), BREW);
      assert.ok(await evaluate(window, `[...document.querySelectorAll(".hero a")].some(a => a.textContent.includes("Get the iPhone beta"))`), "iPhone link");
      await shot(window, "desktop-hero.png");
      window.destroy();
    },
  },
  {
    name: "copy button copies, or selects the command and asks for Command-C",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      await evaluate(window, `document.querySelector(".hero [data-copy]").click()`);
      let label = "";
      for (let i = 0; i < 40 && !/^(Copied|Press ⌘C)$/.test(label); i++) {
        await delay(50);
        label = await evaluate(window, `document.querySelector(".hero [data-copy]").textContent.trim()`);
      }
      assert.match(label, /^(Copied|Press ⌘C)$/);
      if (label === "Press ⌘C") assert.equal(await evaluate(window, `getSelection().toString()`), BREW);
      window.destroy();
    },
  },
  {
    name: "phone width has no horizontal scroll",
    async run(open, evaluate, shot) {
      const window = await open({ width: 390, height: 844, mobile: true });
      const widths = await evaluate(window, `[document.documentElement.scrollWidth, window.innerWidth]`);
      assert.ok(widths[0] <= widths[1], `scrollWidth ${widths[0]} > innerWidth ${widths[1]}`);
      await shot(window, "phone-hero.png");
      window.destroy();
    },
  },
];

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  async function open({ width, height, mobile = false, reducedMotion = false }) {
    const window = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    window.webContents.debugger.attach();
    if (mobile) await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
    if (reducedMotion) await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await window.loadURL(url);
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    return window;
  }
  const evaluate = (window, code) => window.webContents.executeJavaScript(code);
  async function shot(window, name) {
    const dir = process.env.MILAGRE_SCREENSHOT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await delay(300);
    fs.writeFileSync(path.join(dir, name), (await window.webContents.capturePage()).toPNG());
  }
  let failed = false;
  for (const check of checks) {
    try { await check.run(open, evaluate, shot); console.log(`PASS: ${check.name}`); }
    catch (error) { failed = true; console.error(`FAIL: ${check.name}\n${error.stack}`); }
  }
  if (errors.length) { failed = true; console.error(`FAIL: console errors\n${errors.join("\n")}`); }
  server.close();
  app.exit(failed ? 1 : 0);
}

if (process.versions.electron) {
  browserChecks().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("Build the site first: npm run build:site");
    process.exit(1);
  }
  const child = spawn(require("electron"), [__filename], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  child.on("exit", code => process.exit(code ?? 1));
}

module.exports = { checks };
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run build:site && npm run test:site`
Expected: `PASS` for nothing except possibly the phone-width check; `FAIL: desktop hero ...` because `.hero` links do not exist yet. Exit code 1.

- [ ] **Step 3: Implement the download buttons and copy command**

`apps/site/src/components/DownloadButtons.astro`:

```astro
---
import { DOWNLOAD_ARM64, DOWNLOAD_X64 } from "../links";
---
<div class="downloads">
  <a class="button button-primary" href={DOWNLOAD_ARM64}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.5v8.2l2.9-2.9 1 1L8 12.4 4.1 7.8l1-1L8 9.7V1.5h0zM2.5 13h11v1.5h-11z"/></svg>
    Download for macOS
  </a>
  <a class="intel" href={DOWNLOAD_X64}>Intel Mac</a>
</div>

<style>
  .downloads { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .intel { color: var(--ink-3); font-size: 14px; }
  .intel:hover { color: var(--ink-2); }
</style>
```

`apps/site/src/components/CopyCommand.astro`:

```astro
---
interface Props { command: string }
const { command } = Astro.props;
---
<div class="copy-command">
  <code data-command>{command}</code>
  <button type="button" data-copy aria-live="polite">Copy</button>
</div>

<style>
  .copy-command { display: inline-flex; align-items: center; gap: 12px; max-width: 100%; padding: 8px 8px 8px 14px; border-radius: var(--radius-control); background: var(--inset); box-shadow: var(--shadow-card); font-size: 14px; }
  code { min-width: 0; overflow-x: auto; white-space: nowrap; color: var(--ink-2); }
  button { flex-shrink: 0; height: 30px; padding: 0 12px; border: 0; border-radius: var(--radius-chip); background: var(--hover); color: var(--ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  button:hover { background: var(--hover-2); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>

<script>
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", async () => {
      const code = button.parentElement!.querySelector<HTMLElement>("[data-command]")!;
      const text = code.textContent!.trim();
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        // Clipboard unavailable: select the command so the visitor can copy it.
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = "Press ⌘C";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 2000);
    });
  }
</script>
```

- [ ] **Step 4: Implement the hero**

`apps/site/src/components/Hero.astro`:

```astro
---
import DownloadButtons from "./DownloadButtons.astro";
import CopyCommand from "./CopyCommand.astro";
import { BREW_COMMAND, IPHONE_BETA_URL } from "../links";
---
<section class="hero container">
  <h1>Your agents keep working. Answer them from anywhere.</h1>
  <p class="subtitle muted">
    Milagre runs Claude Code and Codex on your Mac, one Git Worktree per Chat. When an agent needs an approval or an answer, it shows up on your desk and on your iPhone.
  </p>
  <DownloadButtons />
  <CopyCommand command={BREW_COMMAND} />
  <a class="iphone" href={IPHONE_BETA_URL}>Get the iPhone beta</a>
  <p class="fine">Free and open source (MIT). Uses your existing Claude Code or Codex login.</p>
  <div class="hero-visual"><slot /></div>
</section>

<style>
  .hero { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 72px 0 40px; text-align: center; }
  h1 { max-width: 15ch; font-size: clamp(40px, 7vw, 72px); font-weight: 700; }
  .subtitle { max-width: 640px; font-size: clamp(17px, 2vw, 19px); }
  .iphone { color: var(--accent-ink); font-weight: 600; text-decoration: none; }
  .iphone:hover { text-decoration: underline; }
  .fine { color: var(--ink-3); font-size: 14px; }
  .hero-visual { width: 100%; margin-top: 36px; }
</style>
```

Replace the `<main>` of `apps/site/src/pages/index.astro` with:

```astro
  <main>
    <Hero />
  </main>
```

and add `import Hero from "../components/Hero.astro";` to its frontmatter.

- [ ] **Step 5: Run the check to make sure it passes**

Run: `npm run build:site && npm run test:site`
Expected: three `PASS` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-site.cjs apps/site/src
git commit -m "feat(site): add the hero with download, brew and iPhone links"
```

---

### Task 4: Hero scene (Mac + iPhone approval)

**Files:**
- Create: `apps/site/src/components/PhoneFrame.astro`, `apps/site/src/components/HeroScene.astro`
- Modify: `apps/site/src/pages/index.astro`, `scripts/test-site.cjs` (append two checks)

**Interfaces:**
- Consumes: `Hero.astro` slot from Task 3; the `checks` array in `scripts/test-site.cjs`.
- Produces: `<PhoneFrame>` with a default slot and an optional `class` prop, reused by Task 6. The scene root is `.scene`; both approval cards carry `data-frame="approval"`.

The still frame (both devices showing the approval, sidebar status orange) is the default CSS. Animation only exists inside `@media (prefers-reduced-motion: no-preference)`. One 8 second cycle:

| Time | Desktop | iPhone |
| --- | --- | --- |
| 0 to 20% | three tool rows appear | idle |
| 28% | approval card appears, status turns orange | idle |
| 36% | | notification banner slides in |
| 50% | | approval card appears |
| 58% | | Approve button pressed |
| 68% | card becomes "Approved from iPhone", status accent | "Approved" |
| 78% | "Checks pass. Ready for review.", status green | |
| 92 to 100% | everything fades for the loop | |

- [ ] **Step 1: Write the failing checks**

Append these two entries to the `checks` array in `scripts/test-site.cjs`:

```js
  {
    name: "hero scene animates when motion is allowed",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      assert.ok(await evaluate(window, `!!document.querySelector(".scene")`), "scene exists");
      assert.equal(await evaluate(window, `document.querySelector(".scene").getAttribute("aria-hidden")`), "true");
      assert.ok(await evaluate(window, `document.querySelector(".scene").getAnimations({ subtree: true }).length > 0`), "animations running");
      window.destroy();
    },
  },
  {
    name: "reduced motion shows the approval on both devices, without animation",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900, reducedMotion: true });
      assert.equal(await evaluate(window, `document.querySelector(".scene").getAnimations({ subtree: true }).length`), 0);
      const opacities = await evaluate(window, `[...document.querySelectorAll('.scene [data-frame="approval"]')].map(el => getComputedStyle(el).opacity)`);
      assert.deepEqual(opacities, ["1", "1"]);
      assert.ok(await evaluate(window, `!!document.querySelector(".scene-description")?.textContent.includes("approval")`), "described for screen readers");
      await shot(window, "desktop-reduced-motion.png");
      window.destroy();
    },
  },
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run build:site && npm run test:site`
Expected: `FAIL: hero scene animates ...` (no `.scene`) and `FAIL: reduced motion ...`.

- [ ] **Step 3: Implement the phone frame**

`apps/site/src/components/PhoneFrame.astro`:

```astro
---
interface Props { class?: string }
const { class: className } = Astro.props;
---
<div class:list={["phone-frame", className]}>
  <div class="island"></div>
  <div class="phone-screen"><slot /></div>
</div>

<style>
  .phone-frame { position: relative; width: 260px; aspect-ratio: 9 / 19.5; padding: 10px; border-radius: 44px; background: oklch(0.16 0.004 264); box-shadow: var(--shadow-overlay), inset 0 0 0 1.5px oklch(1 0 0 / 0.12); }
  .island { position: absolute; top: 18px; left: 50%; width: 76px; height: 22px; border-radius: 999px; background: black; transform: translateX(-50%); z-index: 2; }
  .phone-screen { position: relative; height: 100%; overflow: hidden; border-radius: 34px; background: var(--page); padding: 52px 12px 16px; text-align: left; font-size: 12px; }
</style>
```

- [ ] **Step 4: Implement the scene**

`apps/site/src/components/HeroScene.astro`:

```astro
---
import PhoneFrame from "./PhoneFrame.astro";
---
<p class="scene-description">
  Illustration: a Milagre Chat on a Mac stops at an approval to run the mobile tests, the same approval appears on an iPhone, and approving it on the phone lets the agent finish.
</p>
<div class="scene" aria-hidden="true">
  <div class="mac">
    <div class="mac-bar"><span></span><span></span><span></span></div>
    <div class="mac-body">
      <aside class="side">
        <p class="side-label">Milagre</p>
        <p class="row active"><i class="dot status"></i>Swipe between Chat and Changes</p>
        <p class="row"><i class="dot running"></i>Phone pairing follow-ups</p>
        <p class="row"><i class="dot"></i>Keep the Chat timer running</p>
        <p class="row"><i class="dot"></i>Link Worktrees and share context</p>
      </aside>
      <div class="chat">
        <p class="msg">Run the swipe navigation checks and fix what fails.</p>
        <p class="tool t1"><b>Read</b> apps/mobile/src/chat-pager.tsx</p>
        <p class="tool t2"><b>Edit</b> apps/mobile/src/chat-pager.tsx <span class="add">+18</span> <span class="del">−4</span></p>
        <p class="tool t3"><b>Read</b> scripts/test-mobile.cjs</p>
        <div class="slot">
          <div class="card approval desk-approval" data-frame="approval">
            <p class="card-title">Run <code>npm run test:mobile</code>?</p>
            <p class="card-sub">Run the swipe navigation checks</p>
            <div class="actions"><span class="btn">Deny</span><span class="btn primary">Approve</span></div>
          </div>
          <div class="card approved desk-approved"><p>Approved from iPhone</p></div>
        </div>
        <p class="done">Checks pass. Ready for review.</p>
      </div>
    </div>
  </div>
  <PhoneFrame class="scene-phone">
    <div class="notice">
      <p class="notice-app">Milagre</p>
      <p>Swipe between Chat and Changes needs your approval</p>
    </div>
    <p class="phone-title">Swipe between Chat and Changes</p>
    <div class="slot">
      <div class="card approval phone-approval" data-frame="approval">
        <p class="card-title">Run <code>npm run test:mobile</code>?</p>
        <p class="card-sub">Run the swipe navigation checks</p>
        <div class="actions"><span class="btn">Deny</span><span class="btn primary tap">Approve</span></div>
      </div>
      <div class="card approved phone-approved"><p>Approved</p></div>
    </div>
  </PhoneFrame>
</div>

<style>
  .scene-description { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .scene { position: relative; display: flex; align-items: flex-start; justify-content: center; min-height: 600px; text-align: left; font-size: 13px; }
  .mac { width: min(880px, 100%); border-radius: var(--radius-window); background: var(--canvas); box-shadow: var(--shadow-overlay); overflow: hidden; }
  .mac-bar { display: flex; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .mac-bar span { width: 12px; height: 12px; border-radius: 50%; background: var(--line-strong); }
  .mac-body { display: grid; grid-template-columns: 240px 1fr; min-height: 380px; }
  .side { padding: 14px 10px; border-right: 1px solid var(--line); background: var(--page); }
  .side-label { padding: 0 8px 8px; color: var(--ink-3); font-size: 12px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: var(--radius-control); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row.active { background: var(--hover-2); color: var(--ink); }
  .dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); }
  .dot.running { background: var(--accent); }
  .dot.status { background: var(--orange); }
  .chat { display: flex; flex-direction: column; gap: 10px; padding: 22px 26px; }
  .msg { align-self: flex-end; max-width: 80%; padding: 8px 12px; border-radius: var(--radius-card); background: var(--hover); }
  .tool { color: var(--ink-2); font-family: var(--font-mono); font-size: 12px; }
  .tool b { color: var(--ink); font-weight: 600; margin-right: 6px; }
  .add { color: var(--green); }
  .del { color: var(--orange); }
  .slot { display: grid; }
  .slot > * { grid-area: 1 / 1; }
  .card { padding: 12px 14px; border-radius: var(--radius-card); background: var(--surface); box-shadow: var(--shadow-card); }
  .card-title { color: var(--ink); font-weight: 600; }
  .card-title code { font-size: 12px; color: var(--accent-ink); }
  .card-sub { margin-top: 2px; color: var(--ink-2); font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  .btn { padding: 5px 12px; border-radius: var(--radius-chip); background: var(--hover); font-size: 12px; font-weight: 600; }
  .btn.primary { background: var(--ink); color: var(--page); }
  .approved { opacity: 0; color: var(--green); font-weight: 600; background: var(--green-tint); box-shadow: none; }
  .done { opacity: 0; color: var(--green); font-weight: 600; }
  /* PhoneFrame renders its own root, so reach it with :global inside .scene. */
  .scene :global(.scene-phone) { position: absolute; right: max(0px, calc(50% - 520px)); bottom: 0; width: 240px; }
  .scene :global(.scene-phone .phone-screen) { display: flex; flex-direction: column; gap: 10px; }
  .notice { position: absolute; top: 46px; left: 10px; right: 10px; padding: 10px 12px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-raised); opacity: 0; z-index: 3; }
  .notice-app { color: var(--ink-3); font-size: 11px; font-weight: 600; }
  .phone-title { font-size: 14px; font-weight: 650; }

  @media (max-width: 760px) {
    .mac-body { grid-template-columns: 1fr; min-height: 340px; }
    .side { display: none; }
    .chat { padding: 16px; }
    .scene { min-height: 0; padding-bottom: 120px; }
    .scene :global(.scene-phone) { right: 0; bottom: 0; transform: scale(0.62); transform-origin: bottom right; }
  }

  @media (prefers-reduced-motion: no-preference) {
    .t1 { animation: t1 8s infinite; }
    .t2 { animation: t2 8s infinite; }
    .t3 { animation: t3 8s infinite; }
    .desk-approval { animation: desk-approval 8s infinite; }
    .desk-approved, .phone-approved { animation: approved 8s infinite; }
    .done { animation: done 8s infinite; }
    .dot.status { animation: status 8s infinite; }
    .notice { animation: notice 8s infinite var(--ease-out-strong); }
    .phone-approval { animation: phone-approval 8s infinite; }
    .tap { animation: tap 8s infinite; }
  }

  @keyframes t1 { 0%, 2% { opacity: 0; transform: translateY(4px); } 6%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  @keyframes t2 { 0%, 8% { opacity: 0; transform: translateY(4px); } 12%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  @keyframes t3 { 0%, 14% { opacity: 0; transform: translateY(4px); } 18%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  @keyframes desk-approval { 0%, 24% { opacity: 0; transform: translateY(6px); } 28%, 64% { opacity: 1; transform: none; } 68%, 100% { opacity: 0; } }
  @keyframes approved { 0%, 64% { opacity: 0; } 68%, 92% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes done { 0%, 74% { opacity: 0; transform: translateY(4px); } 78%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  @keyframes status { 0%, 24% { background: var(--accent); } 28%, 64% { background: var(--orange); } 68%, 74% { background: var(--accent); } 78%, 92% { background: var(--green); } 100% { background: var(--accent); } }
  @keyframes notice { 0%, 32% { opacity: 0; transform: translateY(-12px); } 36%, 44% { opacity: 1; transform: none; } 48%, 100% { opacity: 0; transform: translateY(-12px); } }
  @keyframes phone-approval { 0%, 46% { opacity: 0; transform: translateY(6px); } 50%, 64% { opacity: 1; transform: none; } 68%, 100% { opacity: 0; } }
  @keyframes tap { 0%, 56% { transform: none; } 58% { transform: scale(0.92); } 60%, 100% { transform: none; } }
</style>
```

In `apps/site/src/pages/index.astro`, import the scene and pass it into the hero slot:

```astro
---
import HeroScene from "../components/HeroScene.astro";
---
    <Hero><HeroScene /></Hero>
```

- [ ] **Step 5: Run the checks to make sure they pass**

Run: `npm run build:site && MILAGRE_SCREENSHOT_DIR=$TMPDIR/site-check npm run test:site`
Expected: five `PASS` lines, exit 0. Open `$TMPDIR/site-check/desktop-reduced-motion.png` and `phone-hero.png` and confirm both devices are visible and nothing is clipped.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src scripts/test-site.cjs
git commit -m "feat(site): animate the Mac and iPhone approval scene"
```

---

### Task 5: Capture site screenshots from the real renderer

**Files:**
- Create: `scripts/fixtures/demo-desktop.cjs`, `scripts/capture-site.cjs`, `apps/site/src/assets/screenshots/approval.png`, `apps/site/src/assets/screenshots/sidebar.png`, `apps/site/src/assets/screenshots/canvas.png`
- Modify: `scripts/capture-readme.cjs:10-77`

**Interfaces:**
- Produces: `scripts/fixtures/demo-desktop.cjs` exporting `{ projectPath, topics, project, runs, models, linked, projectImage, desktopFixture(theme: "light" | "dark"): string }`. Three PNGs at the paths above, each at least 1200 px wide.

- [ ] **Step 1: Extract the README demo fixture**

Create `scripts/fixtures/demo-desktop.cjs` by moving lines 10 through 77 of `scripts/capture-readme.cjs` into it unchanged (the `projectPath`, `projectImage`, `topics`, `state`, `project`, `run`, `runs`, `models`, `linked` constants and the `fixture` template), with two edits:

1. The `projectImage` path becomes `path.resolve(__dirname, '../../apps/desktop/app/public/logo-milagre-image.png')` and the file requires `fs` and `path` at the top.
2. `const fixture = \`...\`` becomes a function so the theme can vary, and the `localStorage.setItem('milagre-settings', ...)` line inside it uses the parameter:

```js
const desktopFixture = theme => `
import React from 'react';
...
localStorage.setItem('milagre-settings', JSON.stringify({theme:'${theme}',defaultPermissionMode:'auto',notifyWhenWaiting:false,notifyOnCompletion:false,showDockBadge:false,showUsageInSidebar:false}));
createRoot(document.getElementById('root')).render(<App />);
`;

module.exports = { projectPath, topics, project, runs, models, linked, projectImage, desktopFixture };
```

In `scripts/capture-readme.cjs`, replace the moved lines with:

```js
const { projectPath, project, runs, models, projectImage, desktopFixture } = require('./fixtures/demo-desktop.cjs');
const fixture = desktopFixture('light');
```

- [ ] **Step 2: Confirm the README capture still works**

Run `node scripts/capture-readme.cjs $TMPDIR/readme-check` in the background. It writes `desktop.png`, then keeps a mobile fixture server running; stop the process once it prints the `Demo only:` pairing line.
Expected: `$TMPDIR/readme-check/desktop.png` exists and shows the light desktop app with the six demo Chats, as before the refactor.

- [ ] **Step 3: Write the capture script**

`scripts/capture-site.cjs`:

```js
// Captures the landing page screenshots from the real desktop renderer in dark mode.
// Demo data only (scripts/fixtures/demo-desktop.cjs); no provider or personal data is read.
// npm run capture:site
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { desktopFixture } = require('./fixtures/demo-desktop.cjs');

const output = path.resolve(__dirname, '../apps/site/src/assets/screenshots');
const canvasFixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasView } from '/src/components/CanvasView';
import '/src/styles.css';
const state = (id, title, added, removed) => ({ next_id: 5, projects: {}, worktrees: { 1: { id: 1, project_id: 1, path: '/' + id, name: 'main', diff: { added, removed } } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: 'Claude', status: 'Stopped', title } }, messages: [], tasks: {} });
const projects = [
  { id: 'web', path: '/web', name: 'Frontend', openedAt: '2026-10-03T10:00:00Z', position: { x: 0, y: 0 } },
  { id: 'api', path: '/api', name: 'Backend', openedAt: '2026-10-03T09:00:00Z', position: { x: 440, y: 0 } },
];
const links = [{ id: 'link-1', a: { project_id: 'web' }, b: { project_id: 'api' }, created_at: '2026-10-03T10:05:00Z' }];
window.milagre = {
  getCanvas: async () => ({ projects, links, worktreePositions: {}, states: [{ path: '/web', state: state('web', 'Show order history', 48, 6) }, { path: '/api', state: state('api', 'Add the orders endpoint', 112, 9) }] }),
  addLink: async () => links, removeLink: async () => links, setProjectPosition: async () => [], setWorktreePosition: async () => null,
};
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<div style={{ display: 'flex', height: '100vh', padding: '20px', background: 'var(--page)' }}><CanvasView states={{}} runs={{}} linkedWork={{ delegations: [], negotiations: [], receiveOnly: [] }} onOpenChat={() => {}} onBack={() => {}} /></div>);
`;

async function waitFor(window, code, description) {
  for (let i = 0; i < 200; i++) {
    if (await window.webContents.executeJavaScript(code)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

async function capture(desktopUrl, canvasUrl) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-site-electron-')));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1360, height: 860, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on('console-message', e => { if (e.level === 'error') console.error(e.message); });
  const save = async name => {
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await delay(800);
    fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
  };

  await window.loadURL(desktopUrl);
  await waitFor(window, `!!document.querySelector('[data-row]') && !document.querySelector('.startup-splash-screen')`, 'desktop fixture');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => /^new chat$/i.test(b.getAttribute('aria-label') || ''))?.click()`);
  await save('sidebar.png');

  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button, a, [role="button"]')].find(el => el.textContent.includes('Swipe between Chat and Changes'))?.click()`);
  await waitFor(window, `document.body.innerText.includes('Run the swipe navigation checks')`, 'approval card');
  await save('approval.png');

  await window.loadURL(canvasUrl);
  await waitFor(window, `!!document.querySelector('[data-canvas]') && document.body.innerText.includes('Backend')`, 'canvas fixture');
  await save('canvas.png');
  app.exit();
}

async function main() {
  if (process.versions.electron) return capture(process.argv.at(-2), process.argv.at(-1));
  fs.mkdirSync(output, { recursive: true });
  const { createServer } = await import('vite');
  const fixtures = { '/__site_desktop.tsx': desktopFixture('dark'), '/__site_canvas.tsx': canvasFixture };
  const server = await createServer({
    configFile: path.resolve(__dirname, '../apps/desktop/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'site-fixtures',
      resolveId: id => (id in fixtures ? id : null),
      load: id => fixtures[id] ?? null,
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const entry = { '/__site_desktop': '/__site_desktop.tsx', '/__site_canvas': '/__site_canvas.tsx' }[req.url];
          if (!entry) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(req.url, `<html class="dark"><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`));
        });
      },
    }],
  });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const child = spawn(require('electron'), [__filename, `${base}__site_desktop`, `${base}__site_canvas`], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  const code = await new Promise(resolve => child.on('exit', resolve));
  await server.close();
  if (code) throw new Error('Screenshot capture failed');
  for (const name of ['sidebar.png', 'approval.png', 'canvas.png']) {
    const size = fs.statSync(path.join(output, name)).size;
    assert.ok(size > 20000, `${name} looks empty (${size} bytes)`);
    console.log(`Saved ${path.join(output, name)} (${Math.round(size / 1024)} KB)`);
  }
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
```

- [ ] **Step 4: Run it and inspect the images**

Run: `npm run capture:site`
Expected: three `Saved ...` lines. Open each PNG and confirm:
- `sidebar.png`: dark theme, the six demo Chats in the sidebar, the new Chat composer.
- `approval.png`: the "Swipe between Chat and Changes" Chat with the `npm run test:mobile` approval card.
- `canvas.png`: Frontend and Backend nodes joined by a Link line.

If the approval click misses because the Chat row is not a `button`, `a` or `[role="button"]`, find the row element in `apps/desktop/app/src/components/SidebarNav.tsx` (rows carry `data-row`) and target `[data-row]` instead.

- [ ] **Step 5: Commit**

```bash
git add scripts/fixtures/demo-desktop.cjs scripts/capture-readme.cjs scripts/capture-site.cjs apps/site/src/assets/screenshots
git commit -m "feat(site): capture landing screenshots from the desktop renderer"
```

---

### Task 6: Sections 2 to 7

**Files:**
- Create: `apps/site/src/components/Section.astro`, `apps/site/src/components/PhoneChats.astro`, `apps/site/src/components/Faq.astro`
- Modify: `apps/site/src/pages/index.astro`, `scripts/test-site.cjs` (append one check)

**Interfaces:**
- Consumes: `PhoneFrame` (Task 4), screenshots (Task 5), `DownloadButtons`, `CopyCommand`, `links.ts`.
- Produces: `<Section id={string} title={string} reverse?={boolean}>` with a default slot for body text and a named slot `visual`.

- [ ] **Step 1: Write the failing check**

Append to the `checks` array in `scripts/test-site.cjs`:

```js
  {
    name: "sections appear in order with FAQ, images and a closing download",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      const headings = await evaluate(window, `[...document.querySelectorAll("main h2")].map(h => h.textContent.trim())`);
      assert.deepEqual(headings, [
        "Agents stop for you. You'll notice.",
        "Several changes at once, no mixed files",
        "Agents that work across repos",
        "Your Mac does the work. Your phone keeps up.",
        "Local-first",
        "Questions",
        "Download Milagre",
      ]);
      assert.equal(await evaluate(window, `document.querySelectorAll("main details").length`), 5);
      const images = await evaluate(window, `[...document.querySelectorAll("main img")].map(img => ({ alt: img.alt, w: img.getAttribute("width"), h: img.getAttribute("height"), loaded: img.complete && img.naturalWidth > 0 }))`);
      assert.equal(images.length, 3);
      for (const image of images) {
        assert.ok(image.alt.length > 10, "alt text");
        assert.ok(image.w && image.h, "explicit size");
      }
      assert.ok(await evaluate(window, `document.querySelectorAll('main a[href="/download/mac-arm64"]').length >= 2`), "closing download");
      assert.ok(!(await evaluate(window, `/[\\u2013\\u2014]/.test(document.body.innerText)`)), "no en or em dashes in copy");
      const height = await evaluate(window, `document.documentElement.scrollHeight`);
      window.setContentSize(1440, Math.min(height, 12000));
      await shot(window, "desktop-full.png");
      window.destroy();
      const phone = await open({ width: 390, height: 844, mobile: true });
      const widths = await evaluate(phone, `[document.documentElement.scrollWidth, window.innerWidth]`);
      assert.ok(widths[0] <= widths[1], `phone scrollWidth ${widths[0]} > ${widths[1]}`);
      phone.destroy();
    },
  },
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run build:site && npm run test:site`
Expected: `FAIL: sections appear in order ...` with an empty headings array.

- [ ] **Step 3: Implement the section, phone chats and FAQ components**

`apps/site/src/components/Section.astro`:

```astro
---
interface Props { id: string; title: string; reverse?: boolean }
const { id, title, reverse = false } = Astro.props;
---
<section id={id} class:list={["section container", { reverse }]}>
  <div class="copy">
    <h2>{title}</h2>
    <div class="body muted"><slot /></div>
  </div>
  <div class="visual"><slot name="visual" /></div>
</section>

<style>
  .section { display: grid; grid-template-columns: 5fr 7fr; align-items: center; gap: 56px; padding: 96px 0; border-top: 1px solid var(--line); }
  .reverse .copy { order: 2; }
  h2 { font-size: clamp(28px, 3.4vw, 40px); font-weight: 700; }
  .body { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; font-size: 17px; }
  .visual :global(img) { border-radius: var(--radius-window); box-shadow: var(--shadow-overlay); }
  .visual { display: flex; justify-content: center; min-width: 0; }
  @media (max-width: 860px) {
    .section { grid-template-columns: 1fr; gap: 32px; padding: 64px 0; }
    .reverse .copy { order: 0; }
  }
</style>
```

`apps/site/src/components/PhoneChats.astro`:

```astro
---
import PhoneFrame from "./PhoneFrame.astro";
const chats = [
  { title: "Swipe between Chat and Changes", state: "Needs approval", tone: "orange" },
  { title: "Phone pairing follow-ups", state: "Running", tone: "accent" },
  { title: "Find Projects from the phone", state: "Question", tone: "orange" },
  { title: "Keep the Chat timer running", state: "Ready for review", tone: "green" },
  { title: "Link Worktrees and share context", state: "Done", tone: "muted" },
];
---
<PhoneFrame>
  <p class="heading">Chats</p>
  <ul>
    {chats.map(chat => (
      <li>
        <i class:list={["dot", chat.tone]}></i>
        <span class="title">{chat.title}</span>
        <span class="state">{chat.state}</span>
      </li>
    ))}
  </ul>
</PhoneFrame>

<style>
  .heading { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: grid; grid-template-columns: 8px 1fr; column-gap: 10px; align-items: center; padding: 10px; border-radius: var(--radius-card); background: var(--surface); }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .state { grid-column: 2; color: var(--ink-2); font-size: 11px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); }
  .orange { background: var(--orange); }
  .accent { background: var(--accent); }
  .green { background: var(--green); }
</style>
```

`apps/site/src/components/Faq.astro`:

```astro
---
const items = [
  {
    q: "Is it free?",
    a: "Yes. Milagre is free and open source under the MIT license. You pay only for your own Claude or Codex plan.",
  },
  {
    q: "Does my code leave my Mac?",
    a: "Your agents run on your Mac with your own login, so your code goes only where your agent CLI already sends it. Milagre adds no hosted service of its own. When you pair a phone, Chats travel through the relay as encrypted frames it cannot read. Push notifications pass through Expo and Apple and carry Chat titles and previews.",
  },
  {
    q: "Which agents does it support?",
    a: "Claude Code 2.1.288 or newer and Codex CLI 0.160.0 or newer, installed and logged in.",
  },
  {
    q: "Do I need the iPhone app?",
    a: "No. The desktop app works on its own. The iPhone beta lets you follow and answer the same Chats away from your desk, as long as your Mac is awake and online.",
  },
  {
    q: "Is it stable?",
    a: "Milagre is a public alpha. Use Full permission mode only in a Project you can recover.",
  },
];
---
<div class="faq">
  {items.map(item => (
    <details>
      <summary>{item.q}</summary>
      <p class="muted">{item.a}</p>
    </details>
  ))}
</div>

<style>
  .faq { display: flex; flex-direction: column; width: 100%; }
  details { border-bottom: 1px solid var(--line); padding: 18px 0; }
  summary { cursor: pointer; font-weight: 600; font-size: 17px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; float: right; color: var(--ink-3); }
  details[open] summary::after { content: "−"; }
  details p { margin-top: 10px; }
</style>
```

- [ ] **Step 4: Compose the page**

Replace `apps/site/src/pages/index.astro` with:

```astro
---
import { Image } from "astro:assets";
import Base from "../layouts/Base.astro";
import Nav from "../components/Nav.astro";
import Footer from "../components/Footer.astro";
import Hero from "../components/Hero.astro";
import HeroScene from "../components/HeroScene.astro";
import Section from "../components/Section.astro";
import PhoneChats from "../components/PhoneChats.astro";
import Faq from "../components/Faq.astro";
import DownloadButtons from "../components/DownloadButtons.astro";
import CopyCommand from "../components/CopyCommand.astro";
import { BREW_COMMAND, IPHONE_BETA_URL } from "../links";
import approval from "../assets/screenshots/approval.png";
import sidebar from "../assets/screenshots/sidebar.png";
import canvas from "../assets/screenshots/canvas.png";

const title = "Milagre: run Claude Code and Codex on your Mac, answer from anywhere";
const description = "Milagre runs Claude Code and Codex on your Mac, one Git Worktree per Chat. When an agent needs an approval or an answer, it shows up on your desk and on your iPhone.";
---
<Base title={title} description={description}>
  <Nav />
  <main>
    <Hero><HeroScene /></Hero>

    <Section id="approvals" title="Agents stop for you. You'll notice.">
      <p>A task can run for an hour and stop five minutes in for an approval or a question. Milagre puts both inside the Chat, so you answer where you read.</p>
      <p>Pick Ask approval, Auto or Full permissions for each agent.</p>
      <Image slot="visual" src={approval} widths={[800, 1360]} sizes="(max-width: 860px) 100vw, 640px" alt="A Milagre Chat waiting for approval to run npm run test:mobile" />
    </Section>

    <Section id="worktrees" title="Several changes at once, no mixed files" reverse>
      <p>Projects keep related Chats together. Each Chat gets its own Git Worktree, so parallel agents never edit the same files.</p>
      <p>Pull request status sits beside every Chat.</p>
      <Image slot="visual" src={sidebar} widths={[800, 1360]} sizes="(max-width: 860px) 100vw, 640px" alt="The Milagre sidebar with six Chats, each on its own branch" />
    </Section>

    <Section id="links" title="Agents that work across repos">
      <p>Link Projects on the canvas. An agent can read the linked side, delegate a change to that side's agent and negotiate a shared contract, such as an API shape, before either side writes code.</p>
      <Image slot="visual" src={canvas} widths={[800, 1360]} sizes="(max-width: 860px) 100vw, 640px" alt="Two linked Projects, Frontend and Backend, on the Milagre canvas" />
    </Section>

    <Section id="phone" title="Your Mac does the work. Your phone keeps up." reverse>
      <p>Pair your iPhone by scanning the QR code in Settings &gt; Phone. Follow running agents, reply, answer questions and approvals, attach files and inspect changes.</p>
      <p>Your Mac runs the agents, so it needs to stay awake and online.</p>
      <p><a class="link" href={IPHONE_BETA_URL}>Get the iPhone beta</a></p>
      <div slot="visual"><PhoneChats /></div>
    </Section>

    <section id="local" class="plain container">
      <h2>Local-first</h2>
      <ul class="facts">
        <li><b>Your machine, your login.</b> Agents run on your Mac with your own Claude Code or Codex login. Milagre provides no model credentials and no hosted inference.</li>
        <li><b>A relay that can't read.</b> The default phone relay forwards encrypted frames and cannot read Chat traffic.</li>
        <li><b>Requirements.</b> macOS on Apple Silicon or Intel, with Claude Code 2.1.288 or newer, or Codex CLI 0.160.0 or newer. Windows and Linux are coming.</li>
      </ul>
    </section>

    <section id="faq" class="plain container">
      <h2>Questions</h2>
      <Faq />
    </section>

    <section id="download" class="plain closing container">
      <h2>Download Milagre</h2>
      <DownloadButtons />
      <CopyCommand command={BREW_COMMAND} />
    </section>
  </main>
  <Footer />
</Base>

<style>
  .plain { padding: 96px 0; border-top: 1px solid var(--line); }
  .plain h2 { font-size: clamp(28px, 3.4vw, 40px); font-weight: 700; margin-bottom: 28px; }
  .facts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .facts li { padding: 20px; border-radius: var(--radius-card); background: var(--surface); box-shadow: var(--shadow-card); color: var(--ink-2); }
  .facts b { display: block; margin-bottom: 6px; color: var(--ink); }
  .closing { display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
  .closing h2 { margin-bottom: 8px; }
  .link { color: var(--accent-ink); font-weight: 600; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  @media (max-width: 860px) {
    .plain { padding: 64px 0; }
    .facts { grid-template-columns: 1fr; }
  }
</style>
```

- [ ] **Step 5: Run the checks to make sure they pass**

Run: `npm run build:site && MILAGRE_SCREENSHOT_DIR=$TMPDIR/site-check npm run test:site`
Expected: six `PASS` lines, exit 0. Open `$TMPDIR/site-check/desktop-full.png` and read the page top to bottom against the spec copy.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src scripts/test-site.cjs
git commit -m "feat(site): add the approvals, worktrees, links, phone, trust and FAQ sections"
```

---

### Task 7: Open Graph image and metadata check

**Files:**
- Modify: `scripts/capture-site.cjs` (add an `--og` mode), `scripts/test-site.cjs` (append one check)
- Create: `apps/site/public/og.png`, `apps/site/public/robots.txt`

**Interfaces:**
- Consumes: the built `apps/site/dist` and the `serve()` helper pattern from `scripts/test-site.cjs`.
- Produces: `apps/site/public/og.png` at 1200×630.

- [ ] **Step 1: Write the failing check**

Append to the `checks` array in `scripts/test-site.cjs`:

```js
  {
    name: "metadata: canonical, description, Open Graph image",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      const meta = await evaluate(window, `({
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        description: document.querySelector('meta[name="description"]')?.content,
        image: document.querySelector('meta[property="og:image"]')?.content,
        card: document.querySelector('meta[name="twitter:card"]')?.content,
      })`);
      assert.equal(meta.canonical, "https://milagre.cloud/");
      assert.ok(meta.description.startsWith("Milagre runs Claude Code and Codex on your Mac"));
      assert.equal(meta.image, "https://milagre.cloud/og.png");
      assert.equal(meta.card, "summary_large_image");
      assert.ok(fs.existsSync(path.join(dist, "og.png")), "og.png is built");
      assert.ok(fs.existsSync(path.join(dist, "robots.txt")), "robots.txt is built");
      window.destroy();
    },
  },
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run build:site && npm run test:site`
Expected: `FAIL: metadata ...` on `og.png is built`.

- [ ] **Step 3: Add the `--og` capture mode**

In `scripts/capture-site.cjs`, add this function above `main()`:

```js
// Renders the built site's hero at 1200x630 for link previews.
async function captureOg() {
  const http = require('node:http');
  const dist = path.resolve(__dirname, '../apps/site/dist');
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
  const server = http.createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { app, BrowserWindow } = require('electron');
  await app.whenReady();
  const window = new BrowserWindow({ width: 1200, height: 630, useContentSize: true, show: false });
  window.webContents.debugger.attach();
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  await window.webContents.executeJavaScript(`document.querySelector('.nav')?.remove(); document.querySelector('.hero').style.paddingTop = '56px'; document.fonts.ready.then(() => true)`);
  await delay(500);
  fs.writeFileSync(path.resolve(__dirname, '../apps/site/public/og.png'), (await window.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 })).resize({ width: 1200, height: 630 }).toPNG());
  server.close();
  app.exit();
}
```

Change the first line of `main()` to:

```js
  if (process.versions.electron) return process.argv.includes('--og') ? captureOg() : capture(process.argv.at(-2), process.argv.at(-1));
  if (process.argv.includes('--og')) {
    const child = spawn(require('electron'), [__filename, '--og'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    const code = await new Promise(resolve => child.on('exit', resolve));
    if (code) throw new Error('OG capture failed');
    return console.log('Saved apps/site/public/og.png');
  }
```

Create `apps/site/public/robots.txt`:

```
User-agent: *
Allow: /
```

- [ ] **Step 4: Generate the image, rebuild and run the checks**

Run: `npm run build:site && node scripts/capture-site.cjs --og && npm run build:site && npm run test:site`
Expected: `Saved apps/site/public/og.png`, then seven `PASS` lines. Open `apps/site/public/og.png` and confirm the title and both devices are readable at 1200×630.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-site.cjs scripts/test-site.cjs apps/site/public/og.png apps/site/public/robots.txt
git commit -m "feat(site): add the Open Graph image and robots.txt"
```

---

### Task 8: Pull request, then deploy when Victor says so

**Files:**
- Modify: `README.md` (only after the deploy succeeds)

- [ ] **Step 1: Run every check once more**

Run: `npm run test:site:worker && npm run typecheck:site && npm run build:site && MILAGRE_SCREENSHOT_DIR=$TMPDIR/site-pr npm run test:site && npm run test:monorepo`
Expected: all PASS.

Then the manual checks from the spec, on `npm run dev --workspace @milagre/site` (http://127.0.0.1:5190):
- Tab from the top of the page: every link, the copy buttons and each FAQ summary get a visible focus ring, in reading order.
- Lighthouse (Chrome DevTools, mobile preset) on the built site served by `npx astro preview --port 5191` from `apps/site`: Accessibility and Performance both 90 or above. Note the scores in the PR body.

- [ ] **Step 2: Open the pull request**

Push the branch and open a PR. Put `$TMPDIR/site-pr/desktop-full.png`, `phone-hero.png` and `desktop-reduced-motion.png` on the `screenshots` branch under `landing-page/` (temporary worktree, per AGENTS.md) and link them in the PR body by commit SHA. The PR body lists: what the page claims, the `/download/*` behavior, the TestFlight fallback, and that nothing is deployed yet.

- [ ] **Step 3: Stop and wait for the go**

Deploying publishes `milagre.cloud`. Do not run the next steps until Victor explicitly says to deploy.

- [ ] **Step 4: Deploy**

```bash
set -a; . ~/.private_keys/cloudflare.env; set +a
npm run build:site
cd apps/site && npx -y wrangler@4.147.0 deploy
```

Expected: wrangler reports the `milagre-site` Worker with custom domains `milagre.cloud` and `www.milagre.cloud`.

- [ ] **Step 5: Verify production**

```bash
curl -sI https://milagre.cloud/ | head -1
curl -sI https://www.milagre.cloud/ | grep -i -E "^(HTTP|location)"
curl -sI https://milagre.cloud/download/mac-arm64 | grep -i -E "^(HTTP|location)"
curl -sI https://milagre.cloud/download/mac-x64 | grep -i -E "^(HTTP|location)"
curl -sI https://milagre.cloud/download/linux | head -1
```

Expected, in order: `200`; `301` to `https://milagre.cloud/`; `302` to a URL ending `-arm64.dmg`; `302` to a URL ending `-x64.dmg`; `404`.

- [ ] **Step 6: Link the site from the README and commit**

In `README.md`, change the links line under the hero image to:

```markdown
[Website](https://milagre.cloud) · [Download for macOS](https://github.com/the-ptf/milagre-ade/releases/latest) · [Phone setup](docs/mobile-local.md) · [Contributing](CONTRIBUTING.md)
```

```bash
git add README.md
git commit -m "docs: link the website from the README"
```
