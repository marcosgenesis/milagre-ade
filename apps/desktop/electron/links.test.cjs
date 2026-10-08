const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { externalUrl, guardNavigation } = require("./links.cjs");

function fakeContents() {
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = (handler) => {
    contents.openHandler = handler;
  };
  return contents;
}

function navigate(contents, url) {
  let prevented = false;
  contents.emit(
    "will-navigate",
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    url,
  );
  return prevented;
}

test("only web and mail links leave the app", () => {
  assert.equal(externalUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(externalUrl("http://localhost:3000"), "http://localhost:3000/");
  assert.equal(externalUrl("mailto:someone@example.com"), "mailto:someone@example.com");
  assert.equal(externalUrl("file:///etc/passwd"), null);
  assert.equal(externalUrl("javascript:alert(1)"), null);
  assert.equal(externalUrl("data:text/html,hi"), null);
  assert.equal(externalUrl("vscode://file/x"), null);
  assert.equal(externalUrl("not a url"), null);
});

test("links that open a window go to the browser, and no window opens", () => {
  const opened = [];
  const contents = fakeContents();
  guardNavigation(contents, { appUrl: "http://127.0.0.1:5180", openExternal: (url) => opened.push(url) });
  assert.deepEqual(contents.openHandler({ url: "https://example.com" }), { action: "deny" });
  assert.deepEqual(contents.openHandler({ url: "file:///etc/passwd" }), { action: "deny" });
  assert.deepEqual(opened, ["https://example.com/"]);
});

test("the window never navigates away from the app", () => {
  const opened = [];
  const contents = fakeContents();
  guardNavigation(contents, { appUrl: "http://127.0.0.1:5180", openExternal: (url) => opened.push(url) });
  assert.equal(navigate(contents, "http://127.0.0.1:5180/"), false);
  assert.equal(navigate(contents, "http://127.0.0.1:5180/?reload=1"), false);
  assert.equal(navigate(contents, "https://example.com/docs"), true);
  assert.equal(navigate(contents, "http://127.0.0.1:5181/"), true);
  assert.equal(navigate(contents, "file:///tmp/x.html"), true);
  assert.deepEqual(opened, ["https://example.com/docs", "http://127.0.0.1:5181/"]);
});

test("a packaged app may only reload its own page", () => {
  const opened = [];
  const contents = fakeContents();
  guardNavigation(contents, {
    appUrl: "file:///Applications/Milagre.app/Contents/Resources/app.asar/dist/index.html",
    openExternal: (url) => opened.push(url),
  });
  assert.equal(navigate(contents, "file:///Applications/Milagre.app/Contents/Resources/app.asar/dist/index.html#chat"), false);
  assert.equal(navigate(contents, "file:///Users/me/notes.html"), true);
  assert.deepEqual(opened, []);
});

test("an embedded frame stays on the document the app gave it", () => {
  const contents = fakeContents();
  guardNavigation(contents, { appUrl: "http://127.0.0.1:5180/", openExternal: () => {} });
  const frameNavigates = (url, isMainFrame = false) => {
    let prevented = false;
    contents.emit("will-frame-navigate", { url, isMainFrame, preventDefault: () => (prevented = true) });
    return prevented;
  };
  assert.equal(frameNavigates("https://evil.example/collect?d=1"), true, "a design can't load a remote page");
  assert.equal(frameNavigates("data:text/html,hi"), true);
  assert.equal(frameNavigates("about:srcdoc"), false);
  assert.equal(frameNavigates("about:blank"), false);
  assert.equal(frameNavigates("http://127.0.0.1:5180/x"), false);
  assert.equal(frameNavigates("https://evil.example", true), false, "the main frame has will-navigate");
});
