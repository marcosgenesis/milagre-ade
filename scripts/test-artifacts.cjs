// Run with node scripts/test-artifacts.cjs. Checks that a design an agent shows with artifact_show is a card in the
// reply, outside the folded activity, with a sandboxed preview that can't make requests of its own; that Open docks a
// canvas of every design of the Chat beside it, where frames follow revisions and step back through versions, and the
// user can zoom, choose a design and pin comments for the agent; and where the canvas sits as the layout changes.
// Set MILAGRE_SCREENSHOT_DIR to keep screenshots.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const design = (version, accent) => `<!doctype html><html><head><title>Login</title><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #f4f1ec; display: grid; place-items: center; min-height: 100vh; }
  .card { width: 340px; background: white; border-radius: 18px; padding: 32px; box-shadow: 0 12px 40px #0001; }
  h1 { margin: 0 0 6px; font-size: 24px; } p { color: #6b6560; margin: 0 0 24px; }
  input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid #e3ded7; margin-bottom: 12px; font-size: 15px; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 10px; color: white; font-size: 15px; font-weight: 600; background: ${accent}; }
</style></head><body><div class="card"><h1>Welcome back</h1><p>Version ${version} of the login screen</p>
<input placeholder="Email"><input placeholder="Password" type="password"><button>Sign in</button></div>
<script>fetch("https://example.com/collect").then(() => parent.postMessage({ request: "sent" }, "*"), () => parent.postMessage({ request: "blocked" }, "*"));</script>
</body></html>`;

const phone = `<!doctype html><html><head><title>Home</title><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #1f2a24; color: white; min-height: 100vh; padding: 48px 24px; box-sizing: border-box; }
  h1 { font-size: 32px; margin: 0 0 24px; } .habit { background: #ffffff14; border-radius: 16px; padding: 18px; margin-bottom: 12px; font-size: 17px; }
</style></head><body><h1>Good morning</h1><div class="habit">Drink water</div><div class="habit">Morning run</div><div class="habit">Read 20 pages</div></body></html>`;

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { PanelToggles } from "/src/components/agents/PanelToggles";
import { ChangesToggle } from "/src/components/changes/ChangesChrome";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
const designs = { 1: ${JSON.stringify(design(1, "#8a7f74"))}, 2: ${JSON.stringify(design(2, "#2f6f4f"))}, 3: ${JSON.stringify(design(3, "#c2410c"))} };
const home = ${JSON.stringify(phone)};
window.requests = [];
window.calls = [];
window.addEventListener("message", (event) => event.data?.request && window.requests.push(event.data.request));
window.milagre = {
  listEditors: async () => [],
  artifacts: {
    addComments: async ({ comments }) => {
      const added = comments.map((comment, index) => ({ ...comment, id: "c0ffee0" + index, createdAt: 1 }));
      window.kept = [...(window.kept ?? []), ...added];
      return added;
    },
    comments: async () => window.kept ?? [],
    get: async ({ chatId, id, version }) => {
      window.calls.push([chatId, id, version ?? null]);
      if (id === "home") return { id, version: 1, title: "Home", versions: 1, latest: 1, width: 390, height: 844, html: home };
      const latest = window.latest;
      const shown = version ?? latest;
      return { id, version: shown, title: shown === 1 ? "Login screen" : "Login screen, warmer", versions: latest, latest, ...(shown === 1 ? {} : { width: 1280, height: 800 }), html: designs[shown] };
    },
  },
};
window.latest = 2;
window.sent = [];
const step = (version, offset) => ({ id: "s" + version, kind: "artifact", title: "Showed \`Login screen\`", status: "done", offset, artifact: { id: "login", version, title: version === 1 ? "Login screen" : "Login screen, warmer" } });
function Fixture() {
  const [revised, setRevised] = useState(false);
  const [changes, setChanges] = useState(false);
  const [diff, setDiff] = useState(false);
  window.setChanges = setChanges;
  window.setDiff = setDiff;
  window.revise = () => { window.latest = 3; setRevised(true); };
  const [said, setSaid] = useState([]);
  const [resolvedReply, setResolvedReply] = useState(false);
  // The agent resolves the comment, then replies: the Chat moving on is what reads the comments again.
  window.agentResolves = (note) => { window.kept = window.kept.map((comment) => ({ ...comment, resolved: { note, at: 2 } })); setResolvedReply(true); };
  const onSendDesignMessage = async (text) => { window.sent.push(text); setSaid((current) => [...current, text]); return true; };
  const messages = [
    { id: 1, session_id: 1, context: null, role: "user", body: "design a login screen" },
    { id: 2, session_id: 1, context: null, role: "assistant", body: "Here is a first pass.", steps: [step(1, 0)] },
    { id: 3, session_id: 1, context: null, role: "user", body: "warmer, please" },
    { id: 4, session_id: 1, context: null, role: "assistant", body: "Warmer greens, and the home screen.", steps: [step(2, 0), { id: "h1", kind: "artifact", title: "Showed \`Home\`", status: "done", offset: 0, artifact: { id: "home", version: 1, title: "Home" } }] },
    ...(revised ? [{ id: 5, session_id: 1, context: null, role: "assistant", body: "Orange accent.", steps: [step(3, 0)] }] : []),
    ...said.map((body, index) => ({ id: 10 + index, session_id: 1, context: null, role: "user", body })),
    ...(resolvedReply ? [{ id: 30, session_id: 1, context: null, role: "assistant", body: "Made it bigger.", steps: [{ id: "r1", kind: "other", title: "Resolved a design comment", status: "done", offset: 0 }] }] : []),
  ];
  // The app's layout: the chat pane inside the workspace, beside a 260px sidebar.
  return <div style={{ display: "flex", height: "100%" }}><div style={{ width: 260, flexShrink: 0, padding: "56px 12px 12px", boxSizing: "border-box" }}><aside aria-label="Workspace navigation" style={{ height: "100%" }} /></div><main data-workspace-main style={{ display: "flex", flex: 1, minWidth: 0, height: "100%" }}><div data-chat-pane className={diff ? "hidden" : undefined} style={{ flex: 1, minWidth: 0, height: "100%", padding: 12 }}>
    <ChatComposer messages={messages} onSendDesignMessage={onSendDesignMessage}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft="" onDraftChange={noop} onSend={noop} isSending={false} sendBlocked={false}
      streamingText="" asking={false}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={MODEL_CATALOG[0]} onModelChange={noop}
      capability={capabilityFor(MODEL_CATALOG[0], null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div></main>{changes && <div data-changes-slot style={{ width: 300, flexShrink: 0 }} />}</div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<><Fixture /><ChangesToggle open={false} onToggle={() => {}} /><PanelToggles right={52} /></>);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-artifacts-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1280, height: 820, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" && !/Content Security Policy|example\.com/.test(details.message)) console.error(details.message);
  });
  // A failing script names itself: Electron's own error says only that one failed.
  const evaluate = (source) =>
    window.webContents.executeJavaScript(source).catch((error) => {
      throw new Error(`${error.message}\n  in: ${source.slice(0, 300)}`);
    });
  async function screenshot(name) {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    await delay(900);
    const fs = require("node:fs");
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  async function waitFor(source) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  const cards = 'document.querySelectorAll("[data-slot=artifact-card]")';
  const group = 'document.querySelector("[data-slot=artifact-group]")';
  const thumb = (id) => `${group}.querySelector("[data-slot=artifact-thumb][data-artifact=${id}]")`;
  const dock = 'document.querySelector("[data-slot=artifact-dock]")';
  try {
    await window.loadURL(process.argv[2]);
    // The reply that showed two designs has one card for both, a thumbnail each.
    await waitFor(
      `${cards}.length === 1 && !!${cards}[0].querySelector("iframe") && ${group}?.querySelectorAll("[data-slot=artifact-thumb] iframe").length === 2`,
    );
    assert.match(await evaluate(`${group}.textContent`), /2 designs.*Login screen, warmer · Home/);
    assert.equal(await evaluate(`[...${cards}].some((card) => card.closest("[data-slot=activity]"))`), false, "designs are not folded into the activity");
    assert.deepEqual(await evaluate("window.calls"), [
      ["/fixture#1", "login", 1],
      ["/fixture#1", "login", 2],
      ["/fixture#1", "home", 1],
    ]);
    const preview = await evaluate(
      `(() => { const f = ${cards}[0].querySelector("iframe"); return { sandbox: f.getAttribute("sandbox"), csp: f.srcdoc.includes("Content-Security-Policy") }; })()`,
    );
    assert.deepEqual(preview, { sandbox: "allow-scripts", csp: true }, "the preview runs without same origin, under the policy");
    await waitFor("window.requests.length === 2");
    assert.deepEqual(await evaluate("window.requests"), ["blocked", "blocked"], "a design can't make requests of its own");
    assert.ok(
      await evaluate(
        `(() => { const f = ${thumb("home")}.querySelector("iframe").parentElement; return f.style.width === "390px" && f.style.height === "844px"; })()`,
      ),
      "a phone design previews at the phone screen it was made for",
    );
    // Version 1 comes from a host that sends no screen size: it previews at the default size, not as a blank card.
    assert.deepEqual(
      await evaluate(
        `(() => { const f = ${cards}[0].querySelector("iframe").parentElement; return { width: f.style.width, scaled: /scale\\(0\\.\\d+\\)/.test(f.style.transform) }; })()`,
      ),
      { width: "1280px", scaled: true },
    );
    assert.match(await evaluate(`${cards}[0].textContent`), /Login screen.*Version 1.*version 2 is newer/);
    await evaluate(`${group}.scrollIntoView()`);
    await screenshot("card");

    // Open docks the canvas beside the chat with every design of the Chat, and brings the opened one into view.
    const frames = `${dock}.querySelectorAll("[data-slot=artifact-frame]")`;
    const frame = (id) => `${dock}.querySelector("[data-slot=artifact-frame][data-artifact=${id}]")`;
    await evaluate(`${thumb("login")}.click()`);
    await waitFor(`${frames}?.length === 2 && [...${frames}].every((f) => f.querySelector("iframe"))`);
    assert.match(await evaluate(`${frame("login")}.textContent`), /Login screen, warmer.*v2 of 2/);
    // The chat's room springs open with the panel, to the panel's width and its gap.
    await waitFor('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock").trim() === "572px"');
    const inView = (id) =>
      `(() => { const c = ${dock}.querySelector("[data-slot=artifact-canvas]").getBoundingClientRect(); const f = ${frame(id)}.getBoundingClientRect(); return f.left >= c.left - 1 && f.right <= c.right + 1 && f.top >= c.top - 1 && f.bottom <= c.bottom + 1; })()`;
    await waitFor(inView("login"));
    // Once the canvas has slid in and the chat has made room for it.
    await waitFor(
      `(() => { const d = ${dock}.getBoundingClientRect(); const p = document.querySelector("[data-chat-pane]").getBoundingClientRect(); return p.right <= d.left && Math.round(d.top) === 56; })()`,
    );
    const layout = await evaluate(
      `(() => { const d = ${dock}.getBoundingClientRect(); const p = document.querySelector("[data-chat-pane]").getBoundingClientRect(); return { dock: d.left, pane: p.right, top: d.top }; })()`,
    );
    assert.ok(layout.pane <= layout.dock, "the chat ends where the canvas begins");
    assert.ok(layout.dock - 260 > 400, "the chat keeps its room: the workspace reserves the dock once, not again in the chat pane");
    assert.equal(layout.top, 56, "the canvas lines up with the top of the sidebar's card");
    assert.equal(
      await evaluate(`Math.round(${dock}.getBoundingClientRect().bottom) === Math.round(document.querySelector("aside").getBoundingClientRect().bottom)`),
      true,
      "and with its bottom",
    );
    await screenshot("docked");
    // The group card's Open frames every design it showed.
    await evaluate(`${group}.querySelector(":scope > div:last-child button").click()`);
    await waitFor(`${inView("login")} && ${inView("home")}`);
    // Fit shows every design, the phone one at its own size beside the laptop one.
    await evaluate(`${dock}.querySelector("[aria-label='Fit every design']").click()`);
    await waitFor(`${inView("login")} && ${inView("home")}`);
    assert.equal(await evaluate(`${frame("home")}.querySelector("[data-design-body]").parentElement.style.width`), "390px");
    const zoom = await evaluate(`${dock}.querySelector("[data-slot=artifact-zoom]").textContent`);
    await evaluate(`${dock}.querySelector("[aria-label='Zoom in']").click()`);
    await waitFor(`${dock}.querySelector("[data-slot=artifact-zoom]").textContent !== ${JSON.stringify(zoom)}`);
    await evaluate(`${dock}.querySelector("[aria-label='Fit every design']").click()`);
    await screenshot("canvas");

    // Wheel over a design pans the canvas until the design is clicked; then the design takes the mouse, and Escape hands
    // it back without closing the canvas.
    const board = `${dock}.querySelector("[data-slot=artifact-canvas] > div").style.transform`;
    const over = await evaluate(
      `(() => { const r = ${frame("login")}.querySelector("[data-design-body]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    const before = await evaluate(board);
    window.webContents.sendInputEvent({ type: "mouseWheel", x: over.x, y: over.y, deltaX: 0, deltaY: -120 });
    await waitFor(`${board} !== ${JSON.stringify(before)}`);
    const moved = await evaluate(
      `(() => { const r = ${frame("login")}.querySelector("[data-design-body]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    window.webContents.sendInputEvent({ type: "mouseDown", x: moved.x, y: moved.y, button: "left", clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", x: moved.x, y: moved.y, button: "left", clickCount: 1 });
    await waitFor(`${frame("login")}.querySelector("[data-design-body]").dataset.active === "true"`);
    assert.equal(await evaluate(`!!${frame("login")}.querySelector("[data-slot=artifact-shield]")`), false, "the design has the mouse");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor(`!${frame("login")}.querySelector("[data-design-body]").dataset.active && !!${dock}`);
    await evaluate(`${dock}.querySelector("[aria-label='Fit every design']").click()`);

    // A revision from the agent replaces what its frame shows, since the frame follows the newest.
    await evaluate("window.revise()");
    await waitFor(`/v3 of 3/.test(${frame("login")}.textContent)`);
    await screenshot("revised");
    await evaluate(`${frame("login")}.querySelector("[aria-label='Previous version of Login screen, warmer']").click()`);
    await waitFor(`/v2 of 3/.test(${frame("login")}.textContent)`);
    await screenshot("earlier-version");

    // Choosing marks the design but sends nothing until Send.
    await evaluate(`${frame("home")}.querySelector("[aria-label='Choose Home, version 1']").click()`);
    await waitFor(`!!${frame("home")}.querySelector("[data-slot=artifact-choice-pending]")`);
    assert.deepEqual(await evaluate("window.sent"), [], "choosing alone sends nothing");
    assert.match(await evaluate(`${dock}.querySelector("[data-slot=artifact-send]").textContent`), /Send\s*1/);

    // In comment mode a click on a design drops a numbered pin with its bubble open, Figma-like; the comment is written
    // there, and Enter keeps it for Send.
    await evaluate(`${dock}.querySelector("[aria-label='Comment on a design']").click()`);
    await waitFor(`!!${frame("login")}.querySelector("[data-slot=artifact-comment-layer]")`);
    assert.equal(await evaluate(`/pin a comment/i.test(${dock}.textContent)`), false, "no instruction banner");
    const point = await evaluate(
      `(() => { const r = ${frame("login")}.querySelector("[data-slot=artifact-comment-layer]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 4) }; })()`,
    );
    window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await waitFor(`!!${frame("login")}.querySelector("[data-slot=artifact-comment-bubble] textarea") && document.activeElement?.tagName === "TEXTAREA"`);
    const bubble = await evaluate(
      `(() => { const p = ${frame("login")}.querySelector("[data-slot=artifact-pin]").getBoundingClientRect(); const b = ${frame("login")}.querySelector("[data-slot=artifact-comment-bubble]").getBoundingClientRect(); return { gap: b.left - p.right, top: Math.abs(b.top - p.top), width: Math.round(b.width) }; })()`,
    );
    assert.ok(bubble.gap >= 0 && bubble.gap < 16 && bubble.top < 2 && bubble.width === 256, "the bubble opens beside its pin, at screen size");
    assert.equal(await evaluate(`!!${dock}.querySelector("footer")`), false, "comments are written on the canvas, not in a list below it");
    await evaluate(`(() => {
      const box = document.activeElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, "Make the button bigger");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await screenshot("comment");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    await waitFor(`!${frame("login")}.querySelector("[data-slot=artifact-comment-bubble]") && !!${dock}`);
    assert.match(await evaluate(`${frame("login")}.querySelector("[data-slot=artifact-pin]").getAttribute("aria-label")`), /Comment 1: Make the button bigger/);
    assert.match(await evaluate(`${dock}.querySelector("[data-slot=artifact-send]").textContent`), /Send\s*2/);
    await screenshot("pending-feedback");

    // Send carries the choice and the comments in one message.
    await evaluate(`${dock}.querySelector("[data-slot=artifact-send]").click()`);
    await waitFor("window.sent.length === 1");
    assert.match(
      await evaluate("window.sent[0]"),
      /^I chose the design "Home" \(home, version 1\)\. Continue from this one\.\n\nA comment on the designs:\n\n1\. \(comment c0ffee00\) On the design "Login screen, warmer" \(login, version 2\), 50% across and 2\d% down: Make the button bigger\n\n.*artifact_resolve_comment/s,
    );
    await waitFor(`!!${frame("home")}.querySelector("[data-slot=artifact-chosen]") && !${dock}.querySelector("[data-slot=artifact-send]")`);
    assert.equal(await evaluate(`${dock}.querySelectorAll("[data-slot=artifact-pin]").length`), 0, "nothing is left waiting to send");
    // A sent comment stays where it was left, to read back.
    await waitFor(`${frame("login")}.querySelectorAll("[data-slot=artifact-sent-pin]").length === 1`);
    // In the chat the feedback is a card, not the text the agent reads: the choice, and the comment beside its spot.
    const card = 'document.querySelector("[data-slot=design-feedback]")';
    await waitFor(`!!${card}?.querySelector("[data-slot=design-feedback-comment] iframe")`);
    assert.match(await evaluate(`${card}.querySelector("[data-slot=design-feedback-choice]").textContent`), /Chose Home/);
    assert.match(
      await evaluate(`${card}.querySelector("[data-slot=design-feedback-comment]").textContent`),
      /Make the button bigger.*Login screen, warmer · v2/,
    );
    assert.equal(
      await evaluate(`/Revise them with artifact_show/.test(${card}.closest("[data-slot=message]").textContent)`),
      false,
      "the agent's instructions stay out of sight",
    );
    await evaluate(`${card}.scrollIntoView()`);
    await screenshot("feedback-card");
    // The card's comment opens the canvas on it, its bubble open; the choice is only a record.
    assert.equal(await evaluate(`${card}.querySelector("[data-slot=design-feedback-choice]").tagName`), "DIV");
    await evaluate(`${dock}.querySelector("[aria-label='Close designs']").click()`);
    await waitFor(`!${dock}`);
    await evaluate(`${card}.querySelector("[data-slot=design-feedback-comment]").click()`);
    await waitFor(`!!${dock} && /Make the button bigger/.test(${frame("login")}?.querySelector("[data-slot=artifact-comment-bubble]")?.textContent ?? "")`);
    assert.match(await evaluate(`${frame("login")}.querySelector("[data-slot=artifact-comment-bubble]").textContent`), /Sent to the agent/);
    assert.equal(await evaluate(`!!${frame("login")}.querySelector("[data-slot=artifact-comment-bubble] textarea")`), false, "a sent comment can't change");
    await screenshot("sent-comment");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor(`!${frame("login")}.querySelector("[data-slot=artifact-comment-bubble]") && !!${dock}`);

    // The agent resolves the comment with a note: the pin turns green and its bubble and the chat's card show the note.
    await evaluate('window.agentResolves("Sign in button is 48px tall now")');
    await waitFor(`/resolved/.test(${frame("login")}.querySelector("[data-slot=artifact-sent-pin]").getAttribute("aria-label"))`);
    assert.match(await evaluate(`${card}.querySelector("[data-slot=design-feedback-resolved]").textContent`), /Sign in button is 48px tall now/);
    await evaluate(`${frame("login")}.querySelector("[data-slot=artifact-sent-pin]").click()`);
    await waitFor(`/48px tall/.test(${frame("login")}.querySelector("[data-slot=artifact-comment-resolved]")?.textContent ?? "")`);
    await screenshot("resolved-comment");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor(`!${frame("login")}.querySelector("[data-slot=artifact-comment-bubble]") && !!${dock}`);

    // The corner button shows while the Chat has designs, and closes and reopens the canvas.
    const toggle = 'document.querySelector("[data-panel-toggle=designs]")';
    assert.equal(await evaluate(`${toggle}.getAttribute("aria-pressed")`), "true");
    assert.equal(await evaluate('!!document.querySelector("[data-panel-toggle=simulator]")'), false, "no simulator button without a simulator");
    await evaluate(`${toggle}.click()`);
    await waitFor(`!${dock} && ${toggle}.getAttribute("aria-pressed") === "false"`);
    // Holding ⌘ shows each corner button's shortcut under it, short enough not to run into its neighbour's.
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Meta", modifiers: ["meta"] });
    await waitFor('document.querySelectorAll("body > [aria-hidden=true].fixed").length >= 2');
    const badges = await evaluate(
      '[...document.querySelectorAll("body > [aria-hidden=true].fixed")].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, text: b.textContent }; }).sort((a, b) => a.left - b.left)',
    );
    for (let i = 1; i < badges.length; i++) assert.ok(badges[i - 1].right <= badges[i].left, `hints overlap: ${JSON.stringify(badges)}`);
    assert.ok(
      badges.every((badge) => !badge.text.includes("⌘") && badge.top > 40),
      "short hints, under the buttons",
    );
    await screenshot("corner-hints");
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Meta" });
    // Closed and opened again before it finishes closing, the panel turns around and opens whole, not stuck at nothing.
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!${dock} && Math.round(${dock}.getBoundingClientRect().width) === 560`);
    await evaluate(`${toggle}.click()`);
    await delay(80);
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!${dock} && Math.round(${dock}.getBoundingClientRect().width) === 560`);
    await waitFor('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock").trim() === "572px"');
    await evaluate(`${toggle}.click()`);
    await waitFor(`!${dock}`);

    // ⌘⇧E does the same as the button, also while typing in the composer.
    await evaluate('document.querySelector("textarea").focus()');
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "E", modifiers: ["meta", "shift"] });
    await waitFor(`!!${dock} && ${dock}.querySelectorAll("[data-slot=artifact-frame]").length === 2`);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "E", modifiers: ["meta", "shift"] });
    await waitFor(`!${dock}`);
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!${dock} && ${dock}.querySelectorAll("[data-slot=artifact-frame]").length === 2`);

    // The git changes panel opens at the window's right edge: the design docks beside it instead of covering it.
    await evaluate("window.setChanges(true)");
    await waitFor(`Math.round(window.innerWidth - ${dock}.getBoundingClientRect().right) === 312`);
    // With the diff in the chat's place, the design steps aside, and comes back with the chat.
    await evaluate("window.setDiff(true)");
    await waitFor(`!${dock}`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock")'), "", "a hidden design reserves nothing");
    await evaluate("window.setDiff(false)");
    await waitFor(`!!${dock}`);
    await evaluate("window.setChanges(false)");
    await waitFor(`Math.round(window.innerWidth - ${dock}.getBoundingClientRect().right) === 12`);

    // The design can fill the workspace beside the sidebar, covering the chat, and go back beside it.
    await evaluate('window.expandedEvents = 0; window.addEventListener("milagre:designs-expanded", () => window.expandedEvents++)');
    await evaluate(`${dock}.querySelector("[aria-label='Fill the window with the designs']").click()`);
    await waitFor(`${dock}.dataset.full === "true" && Math.round(${dock}.getBoundingClientRect().left) === 260`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock")'), "", "a full design reserves nothing");
    assert.equal(await evaluate("window.expandedEvents"), 1, "expanding asks the other side panels to close");
    await screenshot("expanded");
    await evaluate(`${dock}.querySelector("[aria-label='Show the chat beside the designs']").click()`);
    await waitFor(`!${dock}.dataset.full`);
    // Too narrow for a useful chat beside it, the design fills the workspace on its own.
    window.setContentSize(1100, 820);
    await waitFor(`${dock}.dataset.full === "true" && !${dock}.querySelector("[aria-label='Fill the window with the designs']")`);
    await screenshot("narrow");
    window.setContentSize(1280, 820);
    await waitFor(`!${dock}.dataset.full`);

    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor(`!${dock}`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock")'), "", "closing gives the chat its width back");
    console.log(
      "PASS: a shown design is a card outside the activity with a sandboxed preview at its own screen size that can't make requests; Open docks a canvas of every design at the top right beside the chat (beside the git changes panel, away while the diff replaces the chat, filling the workspace when expanded or narrow), where frames follow revisions and step back through versions, zoom and fit work, wheel over a design pans until the design is clicked, choosing and Figma-like pinned comments wait for Send and reach the agent in one message, and Escape closes it",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "artifacts-fixture",
        resolveId(id) {
          if (id === "/__artifacts_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__artifacts_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__artifacts__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__artifacts_fixture.tsx"></script></body></html>',
            );
            response.setHeader("Content-Type", "text/html");
            response.end(html);
          });
        },
      },
    ],
  });
  try {
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__artifacts__`], { env, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await server.close();
  }
}

(process.versions.electron ? browserChecks() : main()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
