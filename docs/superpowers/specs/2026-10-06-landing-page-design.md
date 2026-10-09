# Landing page design

Status: approved in chat on 2026-10-06, pending review of this written spec.

## Goal

A public landing page at `milagre.cloud` whose one job, during the public alpha, is to get macOS downloads. The iPhone companion is offered as a TestFlight beta. Nothing else (waitlist, accounts, pricing) is in scope.

Success: a developer who lands on the page understands in about five seconds that Milagre runs Claude Code and Codex on their Mac and lets them answer agents from their phone, and can download the right DMG in one click.

## Competitor research (2026-10-05)

Eight pages reviewed: Paseo, T3 Code, Conductor, Superset, Happy, Vibe Kanban, Omnara, Sculptor.

- Everyone opens with a one-line hero, a "Download for macOS" button above the fold and a real product screenshot right below. Paseo, T3 Code and Superset share almost the same dark layout.
- Mobile is table stakes: Paseo, T3 Code, Superset and Happy ship phone apps; Conductor puts its phone app behind Pro ($50/month).
- Trust copy is "bring your own subscription", local and open source. Proof is tweet walls plus GitHub stars (Paseo 19.6k, T3 Code 24k, Happy 23.8k, Vibe Kanban 28.3k).
- A Worktree per Chat is common (Superset, Conductor, Paseo). Linked Projects, Delegation across repos and Negotiation appear on no competitor page.
- Happy has the sharpest mobile pitch: "The agent didn't need you, until it did." Concrete scenes beat category claims ("control plane", "bottleneck has shifted").
- Avoid: "control plane" (Paseo and T3 Code both use it), 40-provider logo lists, 15-section pages, proof numbers we do not have. Our repo has 4 stars, so the page shows no star count.

## Decisions

| Topic | Decision |
| --- | --- |
| Goal | macOS downloads |
| Hero story | An agent stops for an approval on the Mac; you answer it from the iPhone |
| Visual | Dark, using the app's dark theme tokens and dark-mode screenshots |
| Voice | Direct and calm, in the style of the README. English copy |
| iPhone CTA | Public TestFlight link |
| Brand assets | Reuse `apps/desktop/app/public/app-icon.svg` beside the name set in the system font, OG image cut from the hero |
| Stack | Astro, static output, in `apps/site` |
| Hosting | Cloudflare Workers static assets on `milagre.cloud`, `www` redirects to apex |

## Page structure

Seven sections, top to bottom. Nav: logo, Docs (GitHub docs folder), Changelog (GitHub releases), GitHub, "Download".

### 1. Hero

- Title: "Your agents keep working. Answer them from anywhere."
- Subtitle: "Milagre runs Claude Code and Codex on your Mac, one Git Worktree per Chat. When an agent needs an approval or an answer, it shows up on your desk and on your iPhone."
- Primary CTA: "Download for macOS" (Apple Silicon). Below it, a small "Intel Mac" link.
- Copyable command: `brew install --cask the-ptf/tap/milagre`.
- Secondary link: "Get the iPhone beta" (TestFlight).
- Small line: "Free and open source (MIT). Uses your existing Claude Code or Codex login."
- Visual: the hero scene below.

### Hero scene

HTML and CSS, no video. A Mac window and an iPhone frame side by side, built from static markup that copies the app's dark theme. About 8 seconds, looping:

1. A Chat is running; tool rows appear one after another.
2. The agent stops at an approval card ("Run `npm test`?"); the sidebar status becomes "waiting".
3. The iPhone shows the notification, then the same approval card.
4. A tap on "Approve" on the phone; the desktop resumes and ends at "Ready for review".

With `prefers-reduced-motion`, the scene renders frame 3 (both devices showing the approval) as a still. The scene is decorative; its text content is `aria-hidden`, and a visually hidden sentence describes it.

### 2. "Agents stop for you. You'll notice."

A task can run for an hour and stop at minute five for an approval or a question. Questions and approval cards appear inside the Chat. Permission modes per agent: Ask approval, Auto, Full. Screenshot: an approval card in a real Chat.

### 3. "Several changes at once, no mixed files"

Projects group Chats; each Chat gets its own Worktree; pull request status sits beside each Chat. Screenshot: the sidebar with several running and waiting Chats.

### 4. "Agents that work across repos"

The differentiator. Link Projects on the canvas; an agent reads linked context, delegates a change to the other side's agent and negotiates a shared contract such as an API shape. Screenshot: the canvas with a Link between two Projects.

### 5. "Your Mac does the work. Your phone keeps up."

Pair by scanning the QR code in Settings > Phone. Follow running agents, reply, answer questions and approvals, attach files, inspect changes. The Mac must be awake and online. CTA: "Get the iPhone beta". Visual: the HTML iPhone frame from the hero scene showing a Chat list, so no simulator capture is needed.

### 6. "Local-first"

- Agents run on your Mac with your own login. Milagre provides no model credentials and no hosted inference.
- The default relay forwards encrypted frames and cannot read Chat traffic.
- Requirements: macOS (Apple Silicon or Intel); Claude Code 2.1.288+ or Codex CLI 0.160.0+. Windows and Linux: "coming".

Claim limits: push notifications pass through Expo and Apple and are not end-to-end encrypted, so the page never says "end-to-end encrypted" without qualification.

### 7. FAQ and closing CTA

FAQ, collapsed with `<details>`: "Is it free?", "Does my code leave my Mac?", "Which agents does it support?", "Do I need the iPhone app?", "Is it stable?" (answer: public alpha; use Full permissions only in a Project you can recover). Closing CTA repeats the download button and the brew command.

## Architecture

```
apps/site/
  astro.config.mjs        static output
  wrangler.toml           Worker with static assets, routes for milagre.cloud and www
  worker/handler.mjs      www redirect, /download/* redirects, everything else from assets
  worker/worker.ts        Cloudflare entry
  src/pages/index.astro   the page
  src/components/         Hero, HeroScene, Section, Faq, CopyCommand, Nav, Footer
  src/styles/tokens.css   dark tokens copied from apps/desktop/app/src/styles.css
  src/assets/screenshots/ approval.png, sidebar.png, canvas.png (Astro converts to WebP at build)
  public/                 app-icon.svg, og.png
```

- **Downloads.** Release assets carry the version in their names (`Milagre-0.92.0-arm64.dmg`), so static links would go stale. The Worker serves `/download/mac-arm64` and `/download/mac-x64` by reading the latest release from the GitHub API, caching the result for 5 minutes, and redirecting (302) to the matching DMG. If GitHub fails, it redirects to `https://github.com/the-ptf/milagre-ade/releases/latest`.
- **Arch.** Browsers cannot reliably tell Apple Silicon from Intel, so the primary button is Apple Silicon and the "Intel Mac" link sits beneath it.
- **JavaScript.** The hero scene uses CSS animation. The only client script is the copy button for the brew command.
- **Fonts.** The system stack (`ui-sans-serif, system-ui` and `ui-monospace, "SF Mono"`). The desktop app declares Inter but never loads it, so it renders in the system font; the site matches that and ships no font files.
- **Screenshots.** Captured by `scripts/capture-site.cjs` from the real desktop renderer in dark mode with the README demo data (no personal data), committed as PNG under `apps/site/src/assets/screenshots`, and converted to WebP by `astro:assets` at build. These are site assets, not PR evidence, so the "no screenshots in PR commits" rule does not apply to them. PR before/after images still go on the `screenshots` branch.
- **SEO.** Title, description, canonical URL, Open Graph and Twitter tags, `og.png` at 1200×630.

## Deployment

- `npm run build -w apps/site` produces `dist/`; `npx wrangler deploy` from `apps/site` publishes it with the Cloudflare token in `~/.private_keys/cloudflare.env`.
- DNS: `milagre.cloud` and `www.milagre.cloud` are free today (only `mac` and `relay` exist); the Worker claims them as custom domains. `packages.milagre.cloud` stays reserved for the Linux repository.
- No CI deploy in this scope; deploys are run by hand like the relay.

## Prerequisites outside the code

- A public TestFlight link for the external group. It is created in App Store Connect; `scripts/asc.mjs` covers Beta App Review. Until it exists, the "Get the iPhone beta" link points to `docs/mobile-local.md` on GitHub.

## Desktop and mobile sync

The site is a new surface and changes neither the desktop app nor the mobile app, so the AGENTS.md sync rule has no counterpart work here.

## Testing

- `astro check` and the production build pass.
- `scripts/test-site.cjs`: builds the site, serves `dist/` locally, loads it in headless Chromium at 1440×900 and 390×844, asserts the hero title, both download links and the brew command are present, checks there are no console errors, and saves screenshots when `MILAGRE_SCREENSHOT_DIR` is set.
- Worker: unit test for `/download/*` that resolves the asset per arch from a mocked GitHub response and falls back to `releases/latest` on a failed fetch.
- Manual: reduced-motion shows the still frame; keyboard reaches every link and the copy button; Lighthouse accessibility and performance at 90 or above on mobile.

## Out of scope

Waitlist or email capture, pricing, blog, docs site, analytics, i18n, light theme, Windows and Linux download buttons, tweet wall or star count, CI deployment.
