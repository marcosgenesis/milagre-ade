const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// Execute the actual hook/screen handlers without loading native modules in Node.
// Effects are driven explicitly so request ordering is deterministic.
function hookHost({ effects = false } = {}) {
  const slots = [];
  const queuedEffects = [];
  let cursor = 0;
  return {
    begin() {
      cursor = 0;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    // Off by default; when on, an effect runs during the render whose deps changed, after its previous cleanup.
    useEffect(fn, deps) {
      if (!effects) return;
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((value, i) => value === previous.deps[i])) return;
      previous?.cleanup?.();
      slots[index] = { deps, cleanup: fn() };
    },
    createContext() {
      return {};
    },
    useContext() {},
    effect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i])) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        queuedEffects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
    flush() {
      for (const effect of queuedEffects.splice(0)) effect();
    },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}
function load(file, modules, extra = "") {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src", file), "utf8") + extra;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in modules, `Unexpected import: ${id}`);
      return modules[id];
    },
    process: { env: {} },
    URL,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  return exports;
}
const jsx = (type, props) => ({ type, props });
const archiveProgress = load("archive-progress.tsx", {
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": { Text: "Text", View: "View" },
  "./loading-logo": { LoadingLogo: "LoadingLogo" },
  "./ui": { styles: {} },
});
const enterAnimation = {
  duration() {
    return this;
  },
  easing() {
    return this;
  },
  withInitialValues() {
    return this;
  },
  reduceMotion() {
    return this;
  },
};
const reanimatedStub = { default: { View: "AnimatedView" }, FadeInDown: enterAnimation, Easing: { bezier() {} }, ReduceMotion: { System: "system" } };

test("mobile slash suggestions filter skills and insert at the caret while preserving surrounding text", () => {
  const react = hookHost();
  let draft = "Please /tl afterwards";
  const { PromptField } = load("prompt-field.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View" },
    "react-native-reanimated": reanimatedStub,
    "@milagre/shared/prompt-skills": require("../packages/shared/src/prompt-skills.mjs"),
    "./use-rpc": {
      useRpc: () => ({
        data: {
          skills: [
            { name: "other", description: "A description mentioning tldr." },
            { name: "tldr", description: "Rewrite for a skimming reader." },
            { name: "docs", description: "Read documentation." },
            { name: "plugin:review-code", description: "Review code." },
            { name: "docs.v2", description: "Read version two documentation." },
          ],
        },
      }),
    },
    "./ui": { Field: "Field", ListRow: "ListRow", PageScroll: "PageScroll", colors: { ink: "ink", accentInk: "accent" } },
  });
  function render() {
    react.begin();
    return PromptField({
      client: {},
      projectPath: "/project",
      draft,
      onChangeText: (value) => {
        draft = value;
      },
    });
  }
  const field = () => find(render(), (node) => node.type === "Field");
  field().props.onFocus();
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 10, end: 10 } } });
  const suggestion = find(render(), (node) => node.type === "ListRow" && node.props.title === "/tldr");
  assert.equal(find(render(), (node) => node.type === "ListRow").props.title, "/tldr", "name prefixes come before description matches");
  assert.ok(suggestion, "a partial slash skill must open a suggestion");
  assert.equal(
    find(render(), (node) => node.type === "ListRow" && node.props.title === "/docs"),
    undefined,
  );
  suggestion.props.onPress();
  assert.equal(draft, "Please /tldr afterwards");
  assert.deepEqual({ ...field().props.selection }, { start: 13, end: 13 });
  assert.equal(
    find(render(), (node) => node.type === "ListRow"),
    undefined,
    "choosing a skill closes suggestions",
  );
  assert.ok(find(field(), (node) => node.type === "Text" && node.props.children === "/tldr" && node.props.style.color === "accent"));
  for (const punctuation of [".", ",", ":"]) {
    draft = `Please /tl${punctuation} afterwards`;
    field().props.onSelectionChange({ nativeEvent: { selection: { start: 10, end: 10 } } });
    find(render(), (node) => node.type === "ListRow" && node.props.title === "/tldr").props.onPress();
    assert.equal(draft, `Please /tldr${punctuation} afterwards`, "completion preserves sentence punctuation");
    assert.equal(
      find(render(), (node) => node.type === "ListRow"),
      undefined,
    );
  }
  for (const [partial, name] of [
    ["plugin:", "plugin:review-code"],
    ["docs.", "docs.v2"],
  ]) {
    draft = `/${partial}`;
    field().props.onSelectionChange({ nativeEvent: { selection: { start: draft.length, end: draft.length } } });
    find(render(), (node) => node.type === "ListRow" && node.props.title === `/${name}`).props.onPress();
    assert.equal(draft, `/${name} `, "qualified prefixes do not leave duplicate punctuation");
  }
  draft = "/";
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } });
  assert.ok(
    find(render(), (node) => node.type === "ListRow" && node.props.title === "/docs"),
    "a bare slash opens the full catalog",
  );
  field().props.onBlur();
  assert.equal(
    find(render(), (node) => node.type === "ListRow"),
    undefined,
  );
});

test("mobile skill input preserves edits and clears its description when the caret or catalog changes", () => {
  const react = hookHost();
  let catalog = { skills: [{ name: "tldr", description: "Rewrite for a skimming reader." }] };
  let draft = "run /tldr";
  const { PromptField } = load("prompt-field.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View" },
    "react-native-reanimated": reanimatedStub,
    "@milagre/shared/prompt-skills": require("../packages/shared/src/prompt-skills.mjs"),
    "./use-rpc": { useRpc: () => ({ data: catalog }) },
    "./ui": { Field: "Field", ListRow: "ListRow", PageScroll: "PageScroll", colors: { ink: "ink", accentInk: "accent" } },
  });
  function render() {
    react.begin();
    const tree = PromptField({
      client: {},
      projectPath: "/project",
      draft,
      onChangeText: (value) => {
        draft = value;
      },
    });
    react.flush();
    return tree;
  }
  const field = () => find(render(), (node) => node.type === "Field");
  const description = () =>
    find(
      render(),
      (node) =>
        (node.type === "Text" && node.props.children === "Rewrite for a skimming reader.") ||
        (node.type === "ListRow" && node.props.subtitle === "Rewrite for a skimming reader."),
    );
  assert.equal("value" in field().props, false, "native attributed children must not be combined with value");
  assert.ok(find(field(), (node) => node.type === "Text" && node.props.children === "/tldr" && node.props.style.color === "accent"));
  field().props.onFocus();
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 7, end: 7 } } });
  assert.ok(description());
  field().props.onChangeText("run /tldr please");
  assert.equal(draft, "run /tldr please");
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 16, end: 16 } } });
  assert.equal(description(), undefined);
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 7, end: 7 } } });
  assert.ok(description());
  catalog = { skills: [] };
  assert.equal(description(), undefined);
  assert.equal(
    find(field(), (node) => node.type === "Text" && node.props.style.color === "accent"),
    undefined,
  );
  catalog = { skills: [{ name: "tldr", description: "Rewrite for a skimming reader." }] };
  field().props.onBlur();
  assert.equal(description(), undefined);
  draft = "";
  assert.equal(field().props.children.props.children.length, 0, "clearing a sent draft clears native attributed text");
  draft = "run /tldr";
  field().props.onSelectionChange({ nativeEvent: { selection: { start: 4, end: 9 } } });
  catalog = { skills: [] };
  assert.deepEqual({ ...field().props.selection }, { start: 4, end: 9 }, "catalog recoloring preserves the native text selection");
  field().props.onChangeText("run /tldr please");
  assert.equal(field().props.selection, undefined, "ordinary typing keeps native caret control");
});

function markdownHost({ media, basePath } = {}) {
  const react = { ...hookHost({ effects: true }), memo: (fn) => fn };
  const viewer = require("../apps/mobile/src/viewer-store.ts");
  const routes = [],
    links = [];
  const { Markdown } = load("markdown.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Text: "Text",
      View: "View",
      Image: "Image",
      Pressable: "Pressable",
      Alert: {},
      Linking: {
        openURL: async (url) => {
          links.push(url);
        },
      },
    },
    "expo-router": { router: { push: (route) => routes.push(route) } },
    "./viewer-store": viewer,
    "./chat-presentation": require("../apps/mobile/src/chat-presentation.ts"),
    "./markdown-image": require("../apps/mobile/src/markdown-image.ts"),
    "./ui": { PageScroll: "PageScroll", colors: {}, styles: { muted: {}, code: {} } },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return {
    render(text) {
      react.begin();
      return expand(Markdown({ text, media, basePath }));
    },
    routes,
    links,
    viewer,
  };
}

test("Markdown screenshot links render image previews outside Text and open the image viewer", () => {
  const screen = markdownHost();
  const url = "https://raw.githubusercontent.com/marcosgenesis/milagre-ade/22cc3932b99921b51318d869f617db4bfef45523/mobile-push/computers.jpg";
  const rendered = screen.render(`Here is the **Computers screen**:\n\n![Computers with Settings and bottom +](${url})`);
  const image = find(rendered, (node) => node.type === "Image");
  assert.ok(image, "The screenshot must render as an image, not an alt-text placeholder");
  assert.equal(image.props.source.uri, url);
  assert.equal(
    find(rendered, (node) => node.type === "Text" && [node.props.children].flat(Infinity).some((child) => find(child, (nested) => nested.type === "Image"))),
    undefined,
  );
  const preview = find(rendered, (node) => node.props?.accessibilityRole === "imagebutton");
  preview.props.onPress();
  assert.equal(screen.routes.at(-1), "/viewer");
  assert.equal(screen.viewer.viewerImages().images[0].source.uri, url);
});

test("local Markdown images use the computer connection and keep authentication in the viewer", () => {
  const paths = [];
  const source = { uri: "https://mac/media?path=shot", headers: { Authorization: "Bearer paired-token" } };
  const screen = markdownHost({
    basePath: "/worktrees/feature",
    media: (path) => {
      paths.push(path);
      return source;
    },
  });
  const rendered = screen.render("![Screenshot](./screens/left%20bar.png)");
  const image = find(rendered, (node) => node.type === "Image");
  assert.ok(image, "a local path must use the daemon, not disappear into alt text");
  assert.deepEqual(paths, ["/worktrees/feature/screens/left bar.png"]);
  assert.equal(image.props.source, source);
  find(rendered, (node) => node.props?.accessibilityRole === "imagebutton").props.onPress();
  assert.equal(screen.viewer.viewerImages().images[0].source, source);
});

test("relay Markdown images wait for the cached file and render it when ready", async () => {
  const file = deferred();
  const screen = markdownHost({ media: () => file.promise });
  const text = "![Screenshot](/tmp/shot.png)";
  assert.equal(
    find(screen.render(text), (node) => node.type === "Image"),
    undefined,
  );
  file.resolve({ uri: "file:///phone/cache/shot.png" });
  await settle();
  assert.equal(find(screen.render(text), (node) => node.type === "Image")?.props.source.uri, "file:///phone/cache/shot.png");
});

test("images embedded in emphasis, links and tables keep their surrounding text", () => {
  const screen = markdownHost();
  const rendered = screen.render(
    "Before **bold ![Preview](https://example.org/screen.png) after** end.\n\n| Screenshot |\n| --- |\n| [![Table preview](https://example.org/table.png)](https://example.org) |",
  );
  assert.ok(find(rendered, (node) => node.type === "Image" && node.props.source.uri === "https://example.org/screen.png"));
  assert.ok(find(rendered, (node) => node.type === "Image" && node.props.source.uri === "https://example.org/table.png"));
  assert.ok(
    find(
      rendered,
      (node) =>
        node.type === "Text" &&
        Array.isArray(node.props.style) &&
        node.props.style.some((style) => style.fontWeight === "600") &&
        [node.props.children].flat(Infinity).some((child) => find(child, (nested) => nested.type === "Text" && nested.props.children === " after")),
    ),
  );
});

test("a broken Markdown image leaves a browser link, and unsafe sources never load", async () => {
  const screen = markdownHost();
  const text = "![Missing screenshot](https://example.org/missing.png)";
  find(screen.render(text), (node) => node.type === "Image").props.onError();
  const fallback = find(screen.render(text), (node) => node.props?.accessibilityRole === "link");
  assert.ok(fallback);
  await fallback.props.onPress();
  assert.equal(screen.links.at(-1), "https://example.org/missing.png");
  for (const source of ["file:///etc/passwd", "mailto:hello@example.org", "milagre://pair", "https://secret@example.org/image.png"]) {
    assert.equal(
      find(markdownHost().render(`![blocked](${source})`), (node) => node.type === "Image"),
      undefined,
    );
  }
});
const snapshot = (projectPath) => ({ project: { path: projectPath, state: { sessions: {} } }, runs: { runs: {} } });

const relayRuntime = { name: "relay runtime" };
/** The LAN route wiring, stubbed: no native modules, every computer stays on its paired route. Calls are recorded when asked. */
const routesNative = ({ learned = [], forgotten = [] } = {}) => ({
  lanRoutes: {
    set() {},
    forget: (id) => forgotten.push(id),
    checkAll() {},
    subscribe: () => () => {},
    kind: () => "remote",
    view: () => ({ current: () => null, subscribe: () => () => {} }),
  },
  learnRoutes: async (client, host) => {
    learned.push([client.url, host]);
  },
});
function sessionHost(client, { effects = false, AppState = {}, created = [], saved = [], learned = [] } = {}) {
  client.recentScopes ??= () => client.call("project:recent");
  client.open ??= async (owner) => {
    await client.call("project:open", [owner]);
    return client.snapshot(owner);
  };
  const react = hookHost({ effects });
  const { useSessionState, PendingChatsProvider } = load(
    "session.tsx",
    {
      react,
      "@milagre/shared/reconcile": require("@milagre/shared/reconcile"),
      "react/jsx-runtime": { jsx },
      "react-native": { AppState },
      "./client": {
        createClient: (...args) => {
          created.push(args);
          return client;
        },
      },
      "./relay-native": { relayRuntime },
      "./routes-native": routesNative({ learned }),
      "./live": require("../apps/mobile/src/live.ts"),
      "./hosts-native": {
        savedHosts: {
          save: async (host) => {
            saved.push(host);
          },
          list: async () => [],
        },
        savedNavigation: { read: async () => null, save: async () => {} },
        readPermission: async () => null,
        savePermission: async () => {},
      },
      "./turn-options": require("../apps/mobile/src/turn-options.ts"),
      "@milagre/shared/chats": require("@milagre/shared/chats"),
      "@milagre/shared/model": {},
      "./link-operations": require("../apps/mobile/src/link-operations.ts"),
    },
    "\nexport { useSessionState, PendingChatsProvider };",
  );
  return Object.assign(
    () => {
      react.begin();
      return useSessionState();
    },
    {
      unmount: react.unmount,
      pending: (props) => {
        react.begin();
        return PendingChatsProvider(props).props.value;
      },
    },
  );
}

test("pairing through the relay builds the client from the pairing and saves the relay link", async () => {
  const created = [],
    saved = [],
    learned = [];
  const relay = { url: "wss://relay.milagre.cloud", hostId: "H".repeat(22), key: "K".repeat(43) };
  const render = sessionHost({ url: `relay://${relay.hostId}`, call: async (method) => (method === "project:recent" ? [] : {}) }, { created, saved, learned });
  const pairing = { address: `relay://${relay.hostId}`, token: "a".repeat(64), name: "", relay };
  assert.equal(await render().connect(pairing), true);
  assert.equal(created[0][0], pairing);
  assert.equal(created[0][3], relayRuntime);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ name: "Mac", address: `relay://${relay.hostId}`, token: "a".repeat(64), relay }]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(learned)),
    [[`relay://${relay.hostId}`, { token: "a".repeat(64), relay }]],
    "asks the Mac for its LAN route after connecting",
  );
  assert.equal(render().hostName, "Mac");
});

test("a poll from the previous Project cannot restore it after another Project opens", async () => {
  const openingB = deferred(),
    pollingA = deferred();
  let delayA = false;
  const render = sessionHost({
    call: async (method, args) => (method === "project:recent" ? [] : method === "project:open" ? (args[0] === "B" ? openingB.promise : { path: "A" }) : {}),
    snapshot: async (projectPath) => (projectPath === "A" && delayA ? pollingA.promise : snapshot(projectPath)),
  });
  await render().connect({ address: "address", token: "token" });
  await render().open("A");
  const oldSession = render();
  delayA = true;
  const alreadyPolling = oldSession.refresh();
  const opening = oldSession.open("B");
  const pollingDuringOpen = oldSession.refresh();
  openingB.resolve({ path: "B" });
  await opening;
  assert.equal(render().snapshot.project.path, "B");
  pollingA.resolve(snapshot("A"));
  await Promise.all([alreadyPolling, pollingDuringOpen]);
  assert.equal(render().snapshot.project.path, "B");
  await oldSession.refresh();
  assert.equal(render().snapshot.project.path, "B");
});

test("the session fetches on live signals and polls only while the live socket is down", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets = [];
  const fetched = { snapshot: 0, runs: 0 };
  const listeners = [];
  const AppState = {
    currentState: "active",
    addEventListener: (_event, listener) => {
      listeners.push(listener);
      return { remove() {} };
    },
  };
  const setApp = (state) => {
    AppState.currentState = state;
    listeners.forEach((listener) => listener(state));
  };
  const render = sessionHost(
    {
      call: async (method, args) => (method === "project:recent" ? [] : method === "project:open" ? { path: args[0] } : {}),
      snapshot: async (projectPath) => {
        fetched.snapshot++;
        return { ...snapshot(projectPath), runs: { runs: {}, seq: 1 } };
      },
      runs: async () => {
        fetched.runs++;
        return { runs: { "A#1": { text: "streaming" } }, seq: 2 };
      },
      live: (projectPath, options) => {
        const socket = {
          projectPath,
          options,
          closed: false,
          close() {
            socket.closed = true;
          },
        };
        sockets.push(socket);
        return socket;
      },
    },
    { effects: true, AppState },
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const snapshots = async (count, message) => {
    await settle();
    assert.equal(fetched.snapshot, count, message);
  };
  await render().connect({ address: "address", token: "token" });
  await render().open("A");
  render();
  assert.deepEqual(
    sockets.map((socket) => socket.projectPath),
    ["A"],
  );
  await snapshots(2, "opening fetches, then the sync fetches once");
  t.mock.timers.tick(4000);
  await snapshots(3, "it polls while the socket is not open (an older bridge)");
  sockets[0].options.onStatus(true);
  await snapshots(4, "it catches up once the socket opens");
  t.mock.timers.tick(30000);
  await snapshots(4, "no polling while live");
  sockets[0].options.onSignal("runs");
  await settle();
  assert.equal(fetched.runs, 1);
  assert.equal(render().snapshot.runs.runs["A#1"].text, "streaming");
  assert.equal(render().snapshot.project.path, "A");
  sockets[0].options.onSignal("project");
  await snapshots(5);
  sockets[0].options.onStatus(false);
  await snapshots(6, "losing the socket fetches at once");
  t.mock.timers.tick(4000);
  await snapshots(7, "and polls again");
  setApp("background");
  assert.equal(sockets[0].closed, true, "the socket closes in the background");
  t.mock.timers.tick(30000);
  await snapshots(7, "and nothing polls");
  setApp("active");
  assert.equal(sockets.length, 2, "it opens again in the foreground");
  await snapshots(8);
  render.unmount();
  assert.equal(sockets[1].closed, true);
});

test("disconnect cancels a connection that is still loading recent Projects", async () => {
  const recent = deferred();
  const render = sessionHost({ call: async (method) => (method === "project:recent" ? recent.promise : {}) });
  const connecting = render().connect({ address: "address", token: "token" });
  await Promise.resolve();
  render().disconnect();
  recent.resolve([]);
  await connecting;
  assert.equal(render().client, null);
});

function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function chatHost({ pickAttachments = async () => [], call, effects = false, alert = () => {} } = {}) {
  const sending = deferred();
  const calls = [];
  const params = { worktreeId: "1" };
  const session = {
    client: {
      url: "mac",
      call: (method, args) => {
        calls.push({ method, args });
        return call ? call(method, args) : method === "project:branches" ? Promise.resolve(["main"]) : sending.promise;
      },
    },
    snapshot: {
      project: {
        path: "/p",
        name: "P",
        state: { next_id: 4, projects: {}, sessions: {}, messages: [], tasks: {}, worktrees: { 1: { id: 1, name: "main", path: "/p", project_id: 1 } } },
      },
      runs: { runs: {} },
    },
    pendingChats: {},
    setPendingChats(fn) {
      session.pendingChats = fn(session.pendingChats);
    },
    drafts: { "/p#new:1": "first message" },
    attachments: {},
    setAttachments(fn) {
      this.attachments = fn(this.attachments);
    },
    preferences: {},
    defaults: require("../apps/mobile/src/turn-options.ts").defaultPreferences,
    setDefaultPermission() {},
    models: null,
    cliStatus: null,
    linkOperations: require("../apps/mobile/src/link-operations.ts").createLinkOperations(),
    setPreferences(fn) {
      this.preferences = fn(this.preferences);
    },
    setDrafts(fn) {
      this.drafts = fn(this.drafts);
    },
    refresh: async () => {
      session.snapshot.project.state.sessions[42] = { id: 42, provider: "codex" };
    },
    expectActivity() {},
    rememberChat() {},
    isSelected: () => true,
  };
  const react = hookHost({ effects });
  const ui = {
    ...Object.fromEntries(
      ["Button", "GlassIconButton", "IconButton", "ErrorNotice", "Field", "PageScroll", "PillButton", "PullDown", "HeaderButton"].map((name) => [name, name]),
    ),
    styles: { code: {} },
    colors: {},
  };
  const native = {
    ...Object.fromEntries(["KeyboardAvoidingView", "Text", "View", "Image", "Pressable"].map((name) => [name, name])),
    Platform: { OS: "ios" },
    Keyboard: { dismiss() {} },
    Alert: { alert },
    Linking: {},
    StyleSheet: { absoluteFill: {} },
    useColorScheme: () => "light",
  };
  const icons = new Proxy({}, { get: (_, name) => String(name) });
  const router = {
    setParams: (values) => Object.assign(params, values),
    push() {},
    replace(route) {
      router.replaced = route;
    },
    back() {
      router.backs = (router.backs ?? 0) + 1;
    },
  };
  const { default: ChatScreen } = load("app/chat.tsx", {
    "@sbaiahmed1/react-native-blur": { LiquidGlassView: "LiquidGlassView" },
    "expo-crypto": { randomUUID: require("node:crypto").randomUUID },
    "../archive-progress": archiveProgress,
    "../attention": { AttentionPill: () => null },
    "../chat-actions": load("chat-actions.ts", {
      "react-native": { Alert: { alert } },
      "expo-clipboard": { setStringAsync: async () => {} },
      "./archive": require("../apps/mobile/src/archive.ts"),
      "./pins": require("../apps/mobile/src/pins.ts"),
      "./confirm-store": { confirmSheet: (...args) => alert(...args), confirm: async () => true },
    }),
    "@milagre/shared/message-navigation": require("@milagre/shared/message-navigation"),
    "../message-navigation": { MessageNavigation: "MessageNavigation" },
    "../prompt-field": { PromptField: "PromptField" },
    "../context-ring": { ContextRing: "ContextRing" },
    "../theme": { hex: () => ({ surface: "#ffffff" }) },
    "../simulator": { SimulatorChip: "SimulatorChip" },
    "../ports": { PortsChip: "PortsChip" },
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": native,
    "expo-router": {
      Redirect: "Redirect",
      Stack: { Screen: "Screen", Toolbar: Object.assign(() => null, { Menu: "ToolbarMenu", MenuAction: "ToolbarMenuAction", Button: "ToolbarButton" }) },
      router,
      useLocalSearchParams: () => params,
      useFocusEffect: (fn) => react.effect(fn, [fn]),
    },
    "@hugeicons/core-free-icons": icons,
    "@milagre/shared/pr-blockers": require("@milagre/shared/pr-blockers"),
    "../indicators": require("../apps/mobile/src/indicators.ts"),
    "../icons": { Icon: "Icon" },
    "../bottom-fade": { BottomFade: "BottomFade", EdgeFade: "EdgeFade" },
    "../side-panels": { useSidePanels: () => ({ gesture: {}, open: null, show() {} }), PanelSwipe: ({ children }) => children },
    "../loading-logo": { LoadingLogo: "LoadingLogo" },
    "../use-open-project": load("use-open-project.ts", {
      react,
      "expo-router": { router, useFocusEffect: (fn) => react.effect(fn, [fn]) },
      "./session": { useSession: () => session },
    }),
    "../dot-background": { useDotBackground: () => ({}) },
    "react-native-keyboard-controller": { KeyboardChatScrollView: "KeyboardChatScrollView", KeyboardStickyView: "KeyboardStickyView" },
    "../running-logo": { ThinkingIndicator: "ThinkingIndicator" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@milagre/shared/model": require("@milagre/shared/model"),
    "@milagre/shared/agent-runs": { lastUserModel: () => "" },
    "@milagre/shared/chats": require("@milagre/shared/chats"),
    "../session": { useSession: () => session, useComposer: () => session, usePendingChats: () => session },
    "../attachment-picker": { pickAttachments },
    "../attachments": require("../apps/mobile/src/attachments.ts"),
    "../status-indicators": { PullRequestAction: "PullRequestAction", SubagentChip: "SubagentChip", usePullRequest: () => null },
    "../questions": { Approval: "Approval", Questions: "Questions" },
    "../chat-reply": { ChatReply: "ChatReply" },
    "../ui": ui,
    "../agent-controls": { AgentControls: "AgentControls", PermissionChip: "PermissionChip" },
    "../turn-options": require("../apps/mobile/src/turn-options.ts"),
    "../archive": require("../apps/mobile/src/archive.ts"),
    "../confirm-store": { confirmSheet: (...args) => alert(...args) },
  });
  const render = () => {
    react.begin();
    const tree = ChatScreen();
    react.flush();
    return tree;
  };
  const field = () => {
    const props = find(render(), (node) => node.type === "PromptField").props;
    return { ...props, value: props.draft };
  };
  const send = () => find(render(), (node) => node.type === "IconButton" && ["Send message", "Send follow-up"].includes(node.props.label)).props.onPress();
  return { session, sending, params, field, send, render, router, calls };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function subagentsHost({ call = async () => {} } = {}) {
  const react = hookHost();
  const calls = [];
  const state = {
    sessions: {
      7: {
        id: 7,
        subagents: ["running", "completed", "failed", "cancelled", "unknown"].map((status) => ({ id: status, title: status, status, transcript: [] })),
      },
    },
  };
  const session = {
    snapshot: { project: { path: "/project", state } },
    client: {
      async call(method, args) {
        calls.push({ method, args: Array.from(args) });
        await call(method, args);
        const edits = require("@milagre/shared/project-edits");
        const next =
          method === "chat:archive-finished-subagents"
            ? edits.archiveFinishedSubagents(state, args[1])
            : edits.archiveSubagent(state, args[1], args[2], args[3]);
        state.sessions = next.sessions;
      },
    },
    refresh: async () => {},
    expectActivity() {},
  };
  const { default: AgentsSheet } = load("app/agents.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View" },
    "expo-router": { router: { back() {} }, useLocalSearchParams: () => ({ id: "7" }) },
    "@hugeicons/core-free-icons": new Proxy({}, { get: (_, name) => String(name) }),
    "@milagre/shared/project-edits": require("@milagre/shared/project-edits"),
    "../session": { useSession: () => session },
    "../subagent-item": { SubagentItem: "SubagentItem" },
    "../icons": { Icon: "Icon" },
    "../ui": {
      CircleButton: "CircleButton",
      IconButton: "IconButton",
      ListRow: "ListRow",
      ErrorNotice: "ErrorNotice",
      PageScroll: "PageScroll",
      colors: {},
      styles: {},
    },
  });
  const render = () => {
    react.begin();
    return AgentsSheet();
  };
  const button = (title) => find(render(), (node) => node.props?.title === title || node.props?.label === title);
  return { render, button, calls, state, session };
}

test("mobile archives finished subagents without offering archived browsing", async () => {
  const host = subagentsHost();
  const archive = host.button("Archive finished subagents");
  assert.ok(archive, "the sheet must offer bulk archive");
  await archive.props.onPress();
  assert.deepEqual(host.calls[0], { method: "chat:archive-finished-subagents", args: ["/project", 7] });
  assert.deepEqual(
    host.state.sessions[7].subagents.filter((agent) => agent.archived).map((agent) => agent.id),
    ["completed", "failed", "cancelled"],
  );
  assert.equal(host.button("Archive finished subagents").props.disabled, true);
  assert.equal(host.button("Archived (3)"), undefined);
  assert.equal(host.button("Restore completed"), undefined);
  assert.equal(
    find(host.render(), (node) => node.type === "SubagentItem" && node.props.agent.archived),
    undefined,
  );
  await host.button("Archive running").props.onPress();
  assert.deepEqual(host.calls[1], { method: "chat:archive-subagent", args: ["/project", 7, "running", true] });
  assert.equal(
    find(host.render(), (node) => node.type === "SubagentItem" && node.props.agent.id === "running"),
    undefined,
  );
});

test("mobile blocks duplicate archive taps and reports a failed request without hiding entries", async () => {
  const pending = deferred();
  const host = subagentsHost({ call: () => pending.promise });
  const archive = host.button("Archive finished subagents");
  assert.ok(archive, "the sheet must offer bulk archive");
  const first = archive.props.onPress();
  await archive.props.onPress();
  assert.equal(host.calls.length, 1);
  assert.equal(host.button("Archive finished subagents").props.disabled, true);
  pending.reject(new Error("Computer disconnected"));
  await first;
  assert.match(find(host.render(), (node) => node.type === "ErrorNotice").props.message, /Computer disconnected/);
  assert.equal(
    host.state.sessions[7].subagents.some((agent) => agent.archived),
    false,
  );
  assert.equal(host.button("Archive finished subagents").props.disabled, false);
});

test("archived-only subagents hide the mobile Chat menu action and pill", () => {
  const chat = chatHost();
  chat.params.id = "7";
  chat.session.snapshot.project.state.sessions[7] = { id: 7, worktree_id: 1, subagents: [{ id: "done", status: "completed", archived: true }] };
  assert.equal(
    find(chat.render(), (node) => node.type === "ToolbarMenuAction" && node.props.children === "Subagents"),
    undefined,
  );
  assert.equal(
    find(chat.render(), (node) => node.type === "SubagentChip"),
    undefined,
  );
});

test("the mobile composer loads skills from the selected Chat Worktree", () => {
  const chat = chatHost();
  chat.session.snapshot.project.state.worktrees[2] = { id: 2, name: "feature", path: "/worktrees/feature", project_id: 1 };
  chat.params.worktreeId = "2";
  assert.equal(chat.field().projectPath, "/worktrees/feature");
});

test("a mobile Link draft sends through its canonical owner and retries the same operation", async () => {
  let attempts = 0;
  const chat = chatHost({
    effects: true,
    call: async (method) => {
      if (method === "link:send" && ++attempts === 1) throw new Error("Connection lost");
      return { sessionId: 42 };
    },
  });
  const id = "40996067-6cc2-4427-bc1e-9007c5f51875",
    owner = `milagre-link:${id}`;
  const link = {
    link: { id, name: "Food", projectIds: ["api", "web"] },
    projects: [
      { id: "api", path: "/api", name: "API" },
      { id: "web", path: "/web", name: "Web" },
    ],
    state: { next_id: 1, sessions: {}, messages: [], preparations: {} },
  };
  chat.session.snapshot = require("../apps/mobile/src/chat-scope.ts").phoneSnapshot({ link, runs: { runs: {} } });
  chat.params.worktreeId = "0";
  chat.session.drafts = { [`${owner}#new:0`]: "Update both Projects" };
  assert.equal(chat.field().projectPath, "", "A new shared draft never selects a primary Project for skills");
  await chat.send();
  await settle();
  assert.equal(chat.field().value, "Update both Projects", "Failure restores the draft");
  await chat.send();
  await settle();
  const sends = chat.calls.filter((call) => call.method === "link:send");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].args[0].linkId, id);
  assert.equal(sends[0].args[0].sessionId, null);
  assert.equal(sends[0].args[0].operationId, sends[1].args[0].operationId);
  assert.equal("worktreeId" in sends[0].args[0], false);
  assert.equal(
    chat.calls.some((call) => ["worktree:create", "chat:send"].includes(call.method)),
    false,
  );
  assert.equal(chat.params.id, "42");
});

test("browsing another Project in the drawer leaves the current Chat selected", async () => {
  const render = sessionHost({
    url: "mac",
    call: async (method, args) => (method === "project:recent" ? [] : { path: args?.[0] }),
    snapshot: async (path) => snapshot(path),
    preview: async (path) => ({ ...snapshot(path), previewOnly: true }),
  });
  await render().connect({ address: "mac", token: "token" });
  await render().open("/current");
  const before = render();
  const preview = await before.previewProject("/other");
  assert.equal(preview.project.path, "/other");
  assert.equal(preview.previewOnly, true);
  assert.equal(render().snapshot.project.path, "/current");
  assert.equal(before.isSelected(), true);
});

test("closing the drawer during an open keeps the previous Chat usable", async () => {
  const loading = deferred();
  const render = sessionHost({
    url: "mac",
    call: async (method, args) => (method === "project:recent" ? [] : { path: args?.[0] }),
    snapshot: async (path) => (path === "/other" ? loading.promise : snapshot(path)),
  });
  await render().connect({ address: "mac", token: "token" });
  await render().open("/current");
  const before = render();
  const opening = before.open("/other", { background: true });
  render().cancelNavigation();
  loading.resolve(snapshot("/other"));
  assert.equal(await opening, undefined);
  assert.equal(render().snapshot.project.path, "/current");
  assert.equal(before.isSelected(), true);
});

test("a deleted drawer Chat does not switch the Project behind the drawer", async () => {
  const render = sessionHost({
    url: "mac",
    call: async (method, args) => (method === "project:recent" ? [] : { path: args?.[0] }),
    snapshot: async (path) => snapshot(path),
  });
  await render().connect({ address: "mac", token: "token" });
  await render().open("/current");
  await assert.rejects(render().open("/other", { background: true, chatId: 77 }), /no longer available/);
  assert.equal(render().snapshot.project.path, "/current");
});

test("cancelling a computer switch preserves the active Chat selection", async () => {
  const status = deferred();
  let delay = false;
  const render = sessionHost({
    url: "mac",
    call: async (method, args) => (method === "daemon:status" && delay ? status.promise : method === "project:recent" ? [] : { path: args?.[0] }),
    snapshot: async (path) => snapshot(path),
  });
  await render().connect({ address: "mac", token: "token" });
  await render().open("/current");
  const before = render();
  delay = true;
  const connecting = before.connect({ address: "studio", token: "token" });
  render().cancelNavigation();
  status.resolve({});
  assert.equal(await connecting, false);
  assert.equal(before.isSelected(), true);
});

function resumeHost({ target = { hostId: "mac", projectPath: "/last", chatId: 3 }, state = snapshot("/last"), failure } = {}) {
  const react = hookHost();
  react.useEffect = react.effect;
  const routes = [],
    opened = [];
  const session = {
    client: { url: "mac" },
    lastLocation: target,
    open: async (path) => {
      opened.push(path);
      if (failure) throw new Error(failure);
      return state;
    },
  };
  const { default: Screen } = load("app/projects.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", View: "View" },
    "expo-router": {
      Redirect: "Redirect",
      Stack: { Screen: "Screen" },
      router: { replace: (route) => routes.push(route) },
      useLocalSearchParams: () => ({ resume: "1" }),
    },
    "../session": { useSession: () => session },
    "../project-navigation": { ProjectNavigation: "ProjectNavigation" },
    "../ui": { ErrorNotice: "ErrorNotice", styles: {} },
    "../icons": { SpinnerRing: "SpinnerRing" },
    "../loading-logo": { LoadingLogo: "LoadingLogo" },
  });
  return {
    routes,
    opened,
    render() {
      react.begin();
      const tree = Screen();
      react.flush();
      return tree;
    },
    unmount: react.cleanup,
  };
}

test("launch restoration shows the splash animation while the saved Chat opens", () => {
  const app = resumeHost();
  const tree = app.render();
  assert.ok(find(tree, (node) => node.type === "LoadingLogo"));
  assert.equal(
    find(tree, (node) => node.type === "SpinnerRing"),
    undefined,
  );
  assert.ok(find(tree, (node) => node.props.accessibilityRole === "progressbar" && node.props.accessibilityLabel === "Reopening your Chat..."));
});

function navigationHost(opening, { session: extra = {}, alert = () => {}, calls = [] } = {}) {
  const react = hookHost();
  const routes = [];
  const secondaryRoutes = [];
  const opened = [];
  const state = snapshot("/last");
  state.project.state.sessions[3] = { id: 3 };
  state.project.state.worktrees = { 1: { id: 1, path: "/last" } };
  const session = {
    pendingChats: {},
    client: {
      url: "mac",
      call: async (...args) => {
        calls.push(args);
      },
    },
    recent: [{ path: "/last" }],
    hosts: [],
    snapshot: state,
    open: (...args) => {
      opened.push(args);
      return opening;
    },
    reloadProjects: async () => {
      calls.push(["reload"]);
    },
    cachedProject: () => undefined,
    ...extra,
  };
  const native = { Alert: { alert, prompt() {} } };
  // Confirmations use the real sheet store, shown through the host's alert in the order the sheet would list them.
  const confirmStore = load("confirm-store.ts", {});
  confirmStore.setConfirmPresenter(() => {
    const entry = confirmStore.currentConfirmation();
    alert(
      entry.title,
      entry.message,
      entry.buttons.map((button, index) => ({ ...button, onPress: () => entry.choose(index) })),
    );
  });
  const { ProjectNavigation } = load("project-navigation.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      ...Object.fromEntries(["FlatList", "KeyboardAvoidingView", "Pressable", "RefreshControl", "Text", "View"].map((name) => [name, name])),
      ...native,
      Platform: { OS: "ios" },
      StyleSheet: { create: (styles) => styles },
    },
    "expo-clipboard": { setStringAsync: async () => {} },
    "@hugeicons/core-free-icons": {},
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@milagre/shared/chats": { ...require("@milagre/shared/chats"), isListedChat: () => true },
    "@milagre/shared/message-search": require("@milagre/shared/message-search"),
    "./session": { useSession: () => session, useComposer: () => session, usePendingChats: () => session },
    "./indicators": { chatMark: () => "idle" },
    "./status-indicators": { ChatMarkIcon: "ChatMarkIcon" },
    "./icons": { Icon: "Icon", SpinnerRing: "SpinnerRing" },
    "./loading-logo": { LoadingLogo: "LoadingLogo" },
    "./ui": { ...Object.fromEntries(["ErrorNotice", "Field", "IconButton", "PillButton", "PullDown"].map((name) => [name, name])), colors: {}, styles: {} },
    "./archive-progress": archiveProgress,
    "./attention": { AttentionDot: "AttentionDot", useAttention: () => [] },
    "@milagre/shared/agent-runs": { projectOfKey: (key) => key.slice(0, key.lastIndexOf("#")) },
    "./chat-actions": load("chat-actions.ts", {
      "react-native": native,
      "expo-clipboard": { setStringAsync: async () => {} },
      "./archive": require("../apps/mobile/src/archive.ts"),
      "./pins": require("../apps/mobile/src/pins.ts"),
      "./confirm-store": confirmStore,
    }),
    "@milagre/shared/chat-scopes": require("@milagre/shared/chat-scopes"),
    "./accounts-section": { AccountsSection: "AccountsSection" },
    "./confirm-store": confirmStore,
    "./app/settings": { SettingsView: "SettingsView" },
    "./app/notifications": { NotificationsView: "NotificationsView" },
    "./usage-section": { UsageSection: "UsageSection" },
    "./project-icon": { ProjectIcon: "ProjectIcon", ProjectIcons: "ProjectIcons" },
    "./project-search": { ProjectSearch: "ProjectSearch" },
  });
  const render = () => {
    react.begin();
    const tree = ProjectNavigation({
      onNavigate: (route, secondary) => {
        routes.push(route);
        secondaryRoutes.push(secondary);
      },
    });
    return typeof tree.type === "function" ? tree.type(tree.props) : tree;
  };
  const rows = () => find(render(), (node) => node.type === "FlatList");
  const row = (kind, index = 0) => {
    const list = rows();
    return list.props.renderItem({ item: list.props.data.filter((item) => item.kind === kind)[index] });
  };
  // A row's tap target is the menu that also has onPress; its ⋯ is the menu without one.
  const open = (node) => find(node, (child) => child.type === "PullDown" && child.props.onPress);
  const more = (node) => find(node, (child) => child.type === "PullDown" && !child.props.onPress);
  const filter = () => find(render(), (node) => node.type === "PullDown" && node.props.label === "Filter Chats");
  return { state, session, routes, secondaryRoutes, opened, calls, render, rows, row, open, more, filter };
}

test("a sidebar Chat opens at once, leaving its Project to load in the Chat", () => {
  const nav = navigationHost(deferred().promise);
  nav.open(nav.row("chat")).props.onPress();
  assert.deepEqual(nav.opened, [], "the navigation does not open the Project itself");
  assert.deepEqual(JSON.parse(JSON.stringify(nav.routes)), [{ pathname: "/chat", params: { projectPath: "/last", hostId: "mac", id: "3" } }]);
  assert.equal(
    find(nav.render(), (node) => node.type === "LoadingLogo"),
    undefined,
  );
});

test("a new Chat from the sidebar opens at once too", () => {
  const nav = navigationHost(deferred().promise);
  find(nav.row("project"), (node) => node.type === "IconButton").props.onPress();
  assert.deepEqual(nav.opened, []);
  assert.equal(JSON.stringify(nav.routes), JSON.stringify([{ pathname: "/chat", params: { projectPath: "/last", hostId: "mac" } }]));
  assert.equal(
    nav.rows().props.data.some((item) => item.kind === "all"),
    false,
    "no separate Chats screen to go to",
  );
});

test("Add project opens the computer search, and a pick opens its Chat at once", () => {
  const nav = navigationHost(deferred().promise);
  find(nav.render(), (node) => node.props?.accessibilityLabel === "Add project").props.onPress();
  const search = find(nav.render(), (node) => node.type === "ProjectSearch");
  assert.ok(search, "the search replaces the project list");
  search.props.onOpen("/Users/me/Code/app");
  assert.deepEqual(nav.opened, [], "the Chat opens the Project, not the navigation");
  assert.equal(JSON.stringify(nav.routes), JSON.stringify([{ pathname: "/chat", params: { projectPath: "/Users/me/Code/app", hostId: "mac" } }]));
  assert.equal(
    find(nav.render(), (node) => node.type === "ProjectSearch"),
    undefined,
    "the search is put away",
  );
});

test("Settings push onto the native stack from project navigation, preserving the screen to go back to", () => {
  const nav = navigationHost(deferred().promise);
  find(nav.render(), (node) => node.type === "IconButton" && node.props.label === "Settings").props.onPress();
  assert.deepEqual(nav.routes, ["/settings"]);
  assert.deepEqual(nav.secondaryRoutes, [true], "push Settings rather than replacing the originating screen");
  assert.equal(
    find(nav.render(), (node) => node.type === "SettingsView"),
    undefined,
    "Settings is not a custom drawer page",
  );
  assert.ok(find(nav.render(), (node) => node.type === "FlatList"));
});

test("the sidebar filter shows archived, running or waiting Chats across Projects", () => {
  const nav = navigationHost(deferred().promise);
  nav.state.project.state.sessions[4] = { id: 4, archived: true, title: "Old work" };
  const ids = () =>
    JSON.stringify(
      nav
        .rows()
        .props.data.filter((item) => item.kind === "chat")
        .map((item) => item.chat.id),
    );
  assert.equal(ids(), "[3]");
  nav.filter().props.onSelect("archived");
  assert.equal(ids(), "[4]");
  assert.equal(nav.filter().props.sections[0].items.find((item) => item.id === "archived").checked, true);
  nav.filter().props.onSelect("running");
  assert.equal(ids(), "[]", "chatMark is idle in this host, so nothing is running");
});

test("a chat search with no matching title lists matching messages, and a tap opens their Chat", () => {
  const nav = navigationHost(deferred().promise);
  nav.state.project.state.sessions[3] = { id: 3, title: "Relay work" };
  nav.state.project.state.messages = [{ id: 7, session_id: 3, body: "Deploy the relay with wrangler, then check /health" }];
  const search = () => find(nav.render(), (node) => node.type === "Field" && node.props.label === "Search chats");
  search().props.onChangeText("wranglr");
  const data = nav.rows().props.data;
  assert.equal(
    JSON.stringify(data.filter((item) => item.kind === "section" || item.kind === "message").map((item) => item.name ?? item.snippet)),
    JSON.stringify(["Messages", "Deploy the relay with wrangler, then check /health"]),
  );
  const message = nav.row("message");
  assert.equal(message.props.accessibilityLabel, "Deploy the relay with wrangler, then check /health, in Relay work");
  message.props.onPress();
  assert.equal(JSON.stringify(nav.routes), JSON.stringify([{ pathname: "/chat", params: { projectPath: "/last", hostId: "mac", id: "3" } }]));
  search().props.onChangeText("relay");
  assert.equal(
    nav.rows().props.data.some((item) => item.kind === "message"),
    false,
    "a Chat title match keeps messages out",
  );
});

test("a sidebar Project can be removed from the list after confirming", async () => {
  const alerts = [];
  const nav = navigationHost(deferred().promise, { alert: pressDanger(alerts) });
  nav.more(nav.row("project")).props.onSelect("remove");
  await settleAll();
  assert.equal(alerts[0].title, "Remove last?");
  assert.equal(
    JSON.stringify(alerts[0].buttons),
    JSON.stringify([
      ["Remove", "destructive"],
      ["Cancel", "cancel"],
    ]),
  );
  assert.equal(JSON.stringify(nav.calls), JSON.stringify([["project:forget", ["/last"]], ["reload"]]));
});

test("a new Chat reached without a Worktree starts in the Project checkout once it loads", () => {
  const host = chatHost({ effects: true });
  delete host.params.worktreeId;
  host.session.snapshot.project.state.worktrees = { 4: { id: 4, path: "/wt/feature" }, 5: { id: 5, path: "/p" } };
  assert.ok(find(host.render(), (node) => node.type === "LoadingLogo"));
  assert.equal(host.params.worktreeId, "5");
  assert.equal(
    find(host.render(), (node) => node.type === "LoadingLogo"),
    undefined,
  );
});

test("a Chat in another Project loads it behind the splash mark, and shows a failure with Retry", async () => {
  const host = chatHost({ effects: true });
  const opening = [];
  host.session.open = (path, options) => {
    const next = deferred();
    opening.push({ path, options, next });
    return next.promise;
  };
  Object.assign(host.params, { id: "3", projectPath: "/other" });
  assert.ok(find(host.render(), (node) => node.type === "LoadingLogo"));
  assert.equal(JSON.stringify(opening.map((item) => [item.path, item.options])), JSON.stringify([["/other", { chatId: 3 }]]));
  opening[0].next.reject(new Error("This Chat is no longer available. Choose another Chat."));
  await settle();
  const failed = host.render();
  assert.equal(
    find(failed, (node) => node.type === "LoadingLogo"),
    undefined,
  );
  const notice = find(failed, (node) => node.type === "ErrorNotice");
  assert.match(notice.props.message, /no longer available/);
  notice.props.retry();
  host.render();
  assert.equal(opening.length, 2, "Retry opens the Project again");
});

test("launch restoration opens the saved computer/Project/Chat target directly", async () => {
  const state = snapshot("/last");
  state.project.state.sessions[3] = { id: 3 };
  const app = resumeHost({ state });
  app.render();
  await settle();
  assert.deepEqual(app.opened, ["/last"]);
  assert.equal(app.routes.length, 1);
  assert.equal(app.routes[0].pathname, "/chat");
  assert.equal(app.routes[0].params.id, "3");
  assert.equal(app.routes[0].params.hostId, "mac");
  assert.equal(app.routes[0].params.projectPath, "/last");
});

test("missing, archived and unreachable last Chats leave the project list usable", async () => {
  const archived = snapshot("/last");
  archived.project.state.sessions[3] = { id: 3, archived: true };
  for (const input of [{}, { state: archived }, { failure: "offline" }, { target: { hostId: "other", projectPath: "/last", chatId: 3 } }]) {
    const app = resumeHost(input);
    app.render();
    await settle();
    assert.equal(app.routes.length, 0);
    assert.ok(find(app.render(), (node) => node.type === "ProjectNavigation"));
  }
});

function pullDownHost() {
  const sheets = [];
  const modifiers = new Proxy({}, { get: (_, name) => (name === "shapes" ? { rectangle: () => "rectangle" } : (value) => ({ name, value })) });
  const { PullDown } = load("ui.tsx", {
    react: { forwardRef: (fn) => fn },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: "ios" },
      Keyboard: { dismiss() {} },
      ActionSheetIOS: { showActionSheetWithOptions: (options, select) => sheets.push({ options, select }) },
      StyleSheet: { create: (value) => value },
      Pressable: "Pressable",
      View: "View",
    },
    "@expo/ui": {},
    "@expo/ui/swift-ui": Object.fromEntries(
      ["Button", "Host", "Menu", "Picker", "Section", "Text", "Toggle", "HStack", "Image", "Rectangle"].map((name) => [name, `IOS${name}`]),
    ),
    "@expo/ui/swift-ui/modifiers": modifiers,
    "@expo/ui/community/menu": { MenuView: "MenuView" },
    "expo-haptics": { selectionAsync: async () => {} },
    "@hugeicons/core-free-icons": {},
    "./theme": { colors: { ink2: "#aaa", ink3: "#666" }, fonts: { mono: "monospace" } },
    "./icons": { Icon: "Icon" },
    "./confirm-store": { confirmSheet: (...args) => sheets.push(args) },
  });
  return { PullDown, sheets };
}

test("composer attachment choices stay in a native menu after the header action-sheet fix", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const kinds = [];
  const screen = chatHost({
    pickAttachments: async (kind) => {
      kinds.push(kind);
      return [];
    },
  });
  const { PullDown, sheets } = pullDownHost();
  const trigger = find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Add photos or files");
  const rendered = PullDown(trigger.props);
  const menu = find(rendered, (node) => node.type === "IOSMenu");
  assert.ok(menu, "the attachment + must open a menu, not the header action sheet");
  assert.equal(
    find(menu.props.label, (node) => node.type === "View"),
    undefined,
    "the SwiftUI trigger cannot host React Native views",
  );
  const files = find(menu, (node) => node.type === "IOSButton" && node.props.label === "Choose Files");
  files.props.onPress();
  t.mock.timers.tick(250);
  await settle();
  assert.deepEqual(kinds, ["files"]);
  assert.equal(sheets.length, 0);
});

test("header switchers keep the shared native overlay without hosting React views", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { PullDown, sheets } = pullDownHost();
  const selected = [];
  const header = PullDown({
    label: "Switch Chat",
    sections: [
      {
        items: [
          { id: "current", title: "Current Chat", checked: true },
          { id: "other", title: "Other Chat" },
        ],
      },
    ],
    children: jsx("View", {}),
    onSelect: (id) => selected.push(id),
  });
  const menu = find(header, (node) => node.type === "IOSMenu");
  assert.equal(menu.props.label.type, "IOSRectangle");
  assert.equal(
    find(menu, (node) => node.type === "View"),
    undefined,
    "React trigger stays outside SwiftUI",
  );
  find(menu, (node) => node.type === "IOSButton" && node.props.label === "Other Chat").props.onPress();
  t.mock.timers.tick(250);
  assert.deepEqual(selected, ["other"]);
  assert.equal(sheets.length, 0);
});

// A Project with one Chat (5) in a Milagre worktree that holds an uncommitted file, its turn running.
function archiveProject() {
  const calls = [];
  const dirty = { uncommitted: 1, unpushed: 0, branch: "milagre/fix", head: "h1", removable: false };
  const worktrees = { 1: { id: 1, name: "main", path: "/p" }, 2: { id: 2, name: "milagre/fix", path: "/wt/p/fix", base: "main" } };
  const snapshot = {
    project: {
      path: "/p",
      name: "P",
      state: { sessions: { 5: { id: 5, worktree_id: 2, title: "Fix" } }, messages: [{ id: 1, session_id: 5, role: "user", body: "Fix it" }], worktrees },
    },
    runs: { runs: { "/p#5": { questions: [], approvals: [], steps: [] } } },
  };
  const call = async (method, args = []) => {
    calls.push([method, ...args]);
    if (method === "worktree:roots") return ["/wt"];
    if (method === "worktree:status") return dirty;
    return null;
  };
  return { calls, snapshot, call, client: { call, snapshot: async () => snapshot } };
}
// Presses the first destructive button, after recording what the alert showed.
const pressDanger = (alerts) => (title, message, buttons) => {
  alerts.push({ title, message, buttons: buttons.map((button) => [button.text, button.style]) });
  buttons.find((button) => button.style === "destructive").onPress();
};
async function settleAll() {
  for (let i = 0; i < 10; i++) await settle();
}

test("a sidebar Chat Archive asks with the worktree choice, then stops, hides and deletes the worktree", async () => {
  const alerts = [];
  const project = archiveProject();
  const nav = navigationHost(deferred().promise, {
    alert: pressDanger(alerts),
    session: {
      client: { ...project.client, url: "mac" },
      recent: [{ path: "/p" }],
      snapshot: project.snapshot,
      expectActivity() {},
      refresh: async () => {
        project.calls.push(["refresh"]);
      },
    },
  });
  const more = nav.more(nav.row("chat"));
  const archiveItem = more.props.sections.at(-1).items[0];
  assert.equal(archiveItem.id, "archive");
  assert.equal(archiveItem.disabled, undefined, "a running Chat can be archived: it is stopped first");
  more.props.onSelect("archive");
  await settleAll();
  assert.deepEqual(alerts, [
    {
      title: "Archive this Chat?",
      message: "1 uncommitted file will be lost. Commit them first to keep them.",
      buttons: [
        ["Cancel", "cancel"],
        ["Stop, archive and delete worktree", "destructive"],
      ],
    },
  ]);
  assert.deepEqual(
    project.calls.map(([method]) => method),
    ["worktree:roots", "worktree:status", "agent:interrupt", "chat:patch", "worktree:remove", "refresh"],
  );
  assert.deepEqual(project.calls.find(([method]) => method === "worktree:remove").slice(1), [
    "/wt/p/fix",
    {
      force: true,
      base: "main",
      projectPath: "/p",
      chatId: "/p#5",
      seen: { uncommitted: 1, unpushed: 0, branch: "milagre/fix", head: "h1", removable: false },
    },
  ]);
});

test("the Chat screen Archive falls back to a plain Archive on an older Mac, then leaves the Chat", async () => {
  const alerts = [];
  const project = archiveProject();
  const screen = chatHost({
    alert: pressDanger(alerts),
    call: async (method, args) =>
      ["worktree:roots", "worktree:status"].includes(method) ? Promise.reject(new Error("Command is not available from mobile")) : project.call(method, args),
  });
  // The turn has ended on the Mac, so nothing is stopped.
  screen.session.snapshot = { ...project.snapshot, runs: { runs: {} } };
  screen.session.client.snapshot = async () => screen.session.snapshot;
  screen.params.id = "5";
  delete screen.params.worktreeId;
  screen.render();
  const archive = find(screen.render(), (node) => node.type === "ToolbarMenuAction" && node.props.children === "Archive");
  archive.props.onPress();
  await settleAll();
  assert.deepEqual(alerts, [
    {
      title: "Archive this Chat?",
      message: undefined,
      buttons: [
        ["Cancel", "cancel"],
        ["Archive", "destructive"],
      ],
    },
  ]);
  assert.deepEqual(
    screen.calls.map((call) => call.method),
    ["worktree:roots", "chat:patch"],
  );
  assert.deepEqual(screen.calls[1].args, ["/p", 5, { archived: true, unread: false }]);
  assert.equal(screen.router.replaced, "/projects");
});

test("a new Chat can switch Worktrees and keep each Worktree draft", async () => {
  const screen = chatHost();
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: "main" }, 2: { id: 2, name: "feature" } };
  screen.session.drafts["/p#new:2"] = "feature draft";
  const menu = () => find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Choose branch");
  assert.ok(menu(), "the new Chat screen must let you choose a Worktree");
  menu().props.onSelect("2");
  assert.equal(screen.params.worktreeId, "2");
  assert.equal(screen.field().value, "feature draft");
  menu().props.onSelect("1");
  assert.equal(screen.field().value, "first message");
  screen.send();
  assert.ok(
    menu().props.sections[0].items.every((item) => item.disabled),
    "cannot change destination during a send",
  );
  menu().props.onSelect("2");
  assert.equal(screen.params.worktreeId, "1");
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(menu(), undefined, "a sent Chat stays bound to its Worktree");
});

test("new Chats offer Local/New worktree and branches even with one checkout", async () => {
  const screen = chatHost({ effects: true, call: async () => ["main", "release"] });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: "main" } };
  const menu = (label) => find(screen.render(), (node) => node.type === "PullDown" && node.props.label === label);
  assert.ok(menu("Choose isolation"));
  assert.equal(menu("Choose branch").props.sections[0].items[0].title, "main");
  await settle();
  menu("Choose isolation").props.onSelect("worktree");
  const branch = menu("Choose branch");
  assert.deepEqual(
    Array.from(branch.props.sections[0].items, (item) => item.title),
    ["main", "release"],
  );
  branch.props.onSelect("release");
  assert.equal(menu("Choose branch").props.nativeTrigger.title, "release");
  assert.equal(screen.field().value, "first message", "changing the base branch keeps the draft");
  assert.equal(screen.calls.filter((call) => call.method === "project:branches").length, 1);
});

test("New worktree creates from the chosen branch on first send and keeps the selected model", async () => {
  const screen = chatHost({
    effects: true,
    call: async (method) => {
      if (method === "project:branches") return ["main", "release"];
      if (method === "worktree:create") return { worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } };
      return { sessionId: 7 };
    },
  });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: "main" } };
  screen.session.preferences["/p#new:1"] = { ...screen.session.defaults, model: "gpt-6-astra" };
  const menu = (label) => find(screen.render(), (node) => node.type === "PullDown" && node.props.label === label);
  menu("Choose isolation").props.onSelect("worktree");
  await settle();
  menu("Choose branch").props.onSelect("release");
  screen.send();
  assert.ok(menu("Choose isolation").props.nativeTrigger.disabled);
  await settle();
  const created = screen.calls.find((call) => call.method === "worktree:create");
  assert.equal(created.args[0].baseBranch, "release");
  assert.equal(created.args[0].prompt, "first message");
  const sent = screen.calls.find((call) => call.method === "chat:send").args[0];
  assert.equal(sent.worktreeId, 9);
  assert.equal(sent.sessionId, 7);
  assert.equal(sent.model, "gpt-6-astra");
  assert.equal(screen.params.id, "7");
});

test("retrying a failed first send reuses the created worktree and keeps the draft", async () => {
  let sends = 0;
  const screen = chatHost({
    effects: true,
    call: async (method) => {
      if (method === "project:branches") return ["main"];
      if (method === "worktree:create") return { worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } };
      if (++sends === 1) throw new Error("Connection lost");
      return { sessionId: 7 };
    },
  });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: "main" } };
  find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Choose isolation").props.onSelect("worktree");
  await settle();
  screen.send();
  await settle();
  assert.equal(screen.field().value, "first message");
  assert.equal(screen.params.id, undefined);
  screen.send();
  await settle();
  assert.equal(screen.calls.filter((call) => call.method === "worktree:create").length, 1);
  assert.equal(screen.params.id, "7");
});

test("new-worktree preparation finishes its send in the background without navigating after switching Projects", async () => {
  const creating = deferred();
  const screen = chatHost({
    effects: true,
    call: (method) =>
      method === "project:branches" ? Promise.resolve(["main"]) : method === "worktree:create" ? creating.promise : Promise.resolve({ sessionId: 7 }),
  });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: "main" } };
  find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Choose isolation").props.onSelect("worktree");
  await settle();
  screen.send();
  await settle();
  screen.session.snapshot = { ...screen.session.snapshot, project: { ...screen.session.snapshot.project, path: "/other" } };
  screen.render();
  creating.resolve({ worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } });
  await settle();
  assert.equal(screen.calls.filter((call) => call.method === "chat:send").length, 1);
  assert.equal(screen.calls.find((call) => call.method === "chat:send").args[0].projectPath, "/p");
  assert.equal(screen.params.id, undefined);
  assert.equal(screen.session.drafts["/p#new:1"], undefined);
});

test("the attachment pull-down opens the selected picker and blocks a second pick", async () => {
  const picking = deferred();
  const kinds = [];
  const screen = chatHost({
    pickAttachments: (kind) => {
      kinds.push(kind);
      return picking.promise;
    },
  });
  const menu = () => find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Add photos or files");
  assert.ok(menu(), "attachments must use a pull-down anchored to the +");
  menu().props.onSelect("photos");
  assert.ok(menu().props.sections[0].items.every((item) => item.disabled));
  menu().props.onSelect("files");
  assert.deepEqual(kinds, ["photos"]);
  picking.resolve([]);
  await settle();
  menu().props.onSelect("camera");
  await settle();
  assert.deepEqual(kinds, ["photos", "camera"]);
  screen.session.attachments["/p#new:1"] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `${i}.txt`, uri: `file:///${i}.txt`, image: false }));
  assert.ok(menu().props.sections[0].items.every((item) => item.disabled));
  menu().props.onSelect("files");
  assert.deepEqual(kinds, ["photos", "camera"], "four attachments block another picker");
});

test("text typed during the first send follows the created Chat into its composer", async () => {
  const screen = chatHost();
  screen.send();
  screen.field().onChangeText("next message typed during send");
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.params.id, "42");
  assert.equal(screen.field().value, "next message typed during send");
  assert.equal(screen.session.drafts["/p#new:1"], undefined);
});

test("a successful first send clears the sent draft", async () => {
  const screen = chatHost();
  screen.send();
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.params.id, "42");
  assert.equal(screen.field().value, "");
  assert.equal(screen.session.drafts["/p#new:1"], undefined);
});

test("a failed first send restores the sent text alongside the next draft and releases the composer", async () => {
  const screen = chatHost();
  screen.send();
  screen.field().onChangeText("edited during failed send");
  screen.sending.reject(new Error("Connection lost"));
  await settle();
  assert.equal(screen.params.id, undefined);
  assert.equal(screen.field().value, "first message\n\nedited during failed send");
  const button = find(screen.render(), (node) => node.type === "IconButton" && node.props.label === "Send message");
  assert.equal(button.props.disabled, false);
  assert.equal(find(screen.render(), (node) => node.type === "ErrorNotice").props.message, "Connection lost");
});

test("the transcript follows new content, also after the agent settings sheet opens", () => {
  const screen = chatHost();
  const tree = screen.render();
  const page = find(tree, (node) => node.type === "KeyboardChatScrollView");
  let scrolls = 0;
  page.props.ref.current = {
    scrollToEnd() {
      scrolls++;
    },
  };
  page.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  page.props.onContentSizeChange(0, 400);
  assert.equal(scrolls, 0, "a transcript shorter than the screen never scrolls");
  page.props.onContentSizeChange(0, 900);
  assert.equal(scrolls, 1);
  find(tree, (node) => node.type === "AgentControls").props.onToggle();
  page.props.onContentSizeChange(0, 1000);
  assert.equal(scrolls, 2);
});

test("a long Chat opens hidden and jumps to its newest message without animating", () => {
  const screen = chatHost();
  const page = () => find(screen.render(), (node) => node.type === "KeyboardChatScrollView");
  const scrolls = [];
  let first = page();
  first.props.ref.current = {
    scrollToEnd(options) {
      scrolls.push(options);
    },
  };
  assert.equal(first.props.style.opacity, 0);
  first.props.onContentSizeChange(0, 2000);
  assert.equal(scrolls.length, 0, "waits for the viewport before placing");
  first.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  assert.equal(JSON.stringify(scrolls), JSON.stringify([{ animated: false }]));
  const placed = page();
  assert.equal(placed.props.style.opacity, 1);
  placed.props.onContentSizeChange(0, 2100);
  assert.equal(JSON.stringify(scrolls), JSON.stringify([{ animated: false }, { animated: true }]));
  screen.params.id = "42";
  screen.session.snapshot.project.state.sessions[42] = { id: 42, provider: "codex" };
  assert.equal(page().props.style.opacity, 0, "switching Chats hides the next transcript until it is placed");
});

test("mobile navigation spans a long Chat with at most 15 lines and loads older targets before scrolling", () => {
  const screen = chatHost();
  screen.params.id = "42";
  screen.session.snapshot.project.state.sessions[42] = { id: 42, provider: "codex" };
  screen.session.snapshot.project.state.messages = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    session_id: 42,
    role: "assistant",
    body: `Message ${index + 1}`,
  }));
  const tree = screen.render();
  const rail = find(tree, (node) => node.type === "MessageNavigation");
  assert.ok(rail, "Chats have a navigation rail");
  assert.equal(rail.props.items.length, 15);
  assert.equal(rail.props.items[0].index, 0);
  assert.equal(rail.props.items.at(-1).index, 99);
  const page = find(tree, (node) => node.type === "KeyboardChatScrollView");
  const scrolls = [];
  page.props.ref.current = { scrollTo: (options) => scrolls.push(options), scrollToEnd: (options) => scrolls.push({ end: true, ...options }) };
  rail.props.onSelect(0);
  const earlier = screen.render();
  const target = find(earlier, (node) => node.props?.nativeID === "chat-message-1");
  assert.ok(target, "selecting an unloaded message mounts it");
  target.props.onLayout({ nativeEvent: { layout: { y: 84 } } });
  assert.equal(scrolls.at(-1).y, 12, "the first message stays below the transparent header");
  find(earlier, (node) => node.type === "MessageNavigation").props.onSelect(99);
  assert.equal(scrolls.at(-1).end, true, "the latest tick returns to live output");
});

test("the mobile rail stays above the composer when the keyboard lifts it", () => {
  const keyboard = { height: { value: -300 }, progress: { value: 1 } };
  const { MessageNavigation } = load("message-navigation.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Pressable: "Pressable", View: "View" },
    "react-native-reanimated": { default: { View: "AnimatedView" }, useAnimatedStyle: (fn) => fn() },
    "react-native-keyboard-controller": { useReanimatedKeyboardAnimation: () => keyboard },
    "./theme": { colors: {} },
  });
  const props = {
    items: [
      { index: 0, label: "First" },
      { index: 99, label: "Latest" },
    ],
    onSelect() {},
    top: 134,
    bottom: 152,
    keyboardOffset: 24,
  };
  const bottom = (tree) => Object.assign({}, ...[tree.props.style].flat()).bottom;
  assert.equal(bottom(MessageNavigation(props)), 428, "the rail follows the composer by the keyboard height minus its lift offset");
  keyboard.height.value = 0;
  keyboard.progress.value = 0;
  assert.equal(bottom(MessageNavigation(props)), 152, "closing the keyboard restores the rail bounds");
});

test("Go to bottom returns the mobile transcript to the end and resumes following", () => {
  const screen = chatHost({ effects: true });
  const page = () => find(screen.render(), (node) => node.type === "KeyboardChatScrollView");
  const jump = () => find(screen.render(), (node) => node.type === "GlassIconButton" && node.props.label === "Go to bottom");
  const scrolls = [];
  page().props.ref.current = {
    scrollToEnd(options) {
      scrolls.push(options);
    },
  };
  page().props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  page().props.onContentSizeChange(0, 1800);
  assert.equal(JSON.stringify(scrolls), JSON.stringify([{ animated: false }]), "Opening places the Chat at its end");
  scrolls.length = 0;
  page().props.onEndVisible(true);
  assert.equal(jump(), undefined, "No button when the end is visible, including short chats");
  page().props.onScroll({ nativeEvent: { contentSize: { height: 1800 }, contentOffset: { y: 200 }, layoutMeasurement: { height: 600 } } });
  page().props.onEndVisible(false);
  assert.ok(jump(), "The keyboard-aware end callback reveals the button");
  page().props.onContentSizeChange(0, 1900);
  assert.equal(scrolls.length, 0, "New output leaves earlier messages in place");
  jump().props.onPress();
  assert.equal(JSON.stringify(scrolls), JSON.stringify([{ animated: false }]), "The jump reaches the end without intermediate scroll events disabling follow");
  assert.equal(jump(), undefined);
  page().props.onContentSizeChange(0, 2000);
  assert.equal(scrolls.length, 2, "Following resumes after the jump");
  page().props.onEndVisible(false);
  assert.ok(jump());
  page().props.onEndVisible(true);
  assert.equal(jump(), undefined, "Scrolling back to the end manually hides the button");
  page().props.onEndVisible(false);
  screen.params.id = "42";
  screen.render();
  assert.equal(jump(), undefined, "Switching Chats clears the previous button state");
});

test("live tool activity opens in the activity sheet instead of expanding in the transcript", () => {
  const screen = chatHost();
  screen.params.id = "42";
  screen.session.snapshot.project.state.sessions[42] = { id: 42, provider: "codex" };
  screen.session.snapshot.runs.runs["/p#42"] = { text: "", steps: [], approvals: [], questions: [] };
  const tree = screen.render();
  const pushed = [];
  screen.router.push = (route) => pushed.push(route);
  find(tree, (node) => node.type === "ChatReply").props.onActivity("run");
  assert.equal(JSON.stringify(pushed), JSON.stringify([{ pathname: "/activity", params: { id: "42", message: "run" } }]));
});

test("switching the requested diff hides old content and ignores its late response", async () => {
  const react = hookHost();
  let currentDeps, cleanup, pendingEffect;
  react.useEffect = (effect, deps) => {
    if (!currentDeps || deps.some((value, index) => value !== currentDeps[index])) {
      currentDeps = deps;
      pendingEffect = () => {
        cleanup?.();
        cleanup = effect();
      };
    }
  };
  const first = deferred(),
    second = deferred();
  const client = { call: (_method, args) => (args[0].path === "first" ? first.promise : second.promise) };
  const { useRpc } = load("use-rpc.ts", { react });
  let file = "first";
  const render = () => {
    react.begin();
    const value = useRpc(client, "git:diff-file", [{ path: file }]);
    const effect = pendingEffect;
    pendingEffect = null;
    effect?.();
    return value;
  };
  assert.equal(render().loading, true);
  file = "second";
  assert.equal(render().data, null);
  second.resolve({ patch: "+second" });
  await settle();
  assert.equal(render().data.patch, "+second");
  first.resolve({ patch: "+first" });
  await settle();
  assert.equal(render().data.patch, "+second");
  cleanup?.();
});

test("late Chat rename cannot pop another screen after its form loses focus", async () => {
  const saving = deferred(),
    react = hookHost();
  let cleanup,
    backs = 0;
  const session = {
    client: { call: () => saving.promise },
    snapshot: { project: { path: "/A", state: { sessions: { 1: { id: 1, title: "Chat" } } } }, runs: { runs: {} } },
    isSelected: () => true,
    refresh: async () => {},
  };
  const { default: Form } = load("app/chat-details.tsx", {
    "../archive-progress": archiveProgress,
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text" },
    "expo-router": {
      Redirect: "Redirect",
      router: { back: () => backs++ },
      useLocalSearchParams: () => ({ id: "1" }),
      useFocusEffect: (fn) => {
        cleanup = fn();
      },
    },
    "../session": { useSession: () => session, useComposer: () => session, usePendingChats: () => session },
    "../attachment-picker": { pickAttachments: async () => [] },
    "../attachments": require("../apps/mobile/src/attachments.ts"),
    "../status-indicators": { ChatStatus: "ChatStatus", AgentStatus: "AgentStatus", WorktreeStatus: "WorktreeStatus" },
    "../ui": { ...Object.fromEntries(["Button", "ErrorNotice", "Field", "PageScroll"].map((name) => [name, name])), styles: {} },
  });
  react.begin();
  const tree = Form();
  find(tree, (n) => n.type === "Button" && n.props.title === "Save name").props.onPress();
  cleanup?.();
  saving.resolve({});
  await settle();
  assert.equal(backs, 0);
});

test("selection guards expire when Project or connection changes", async () => {
  const render = sessionHost({ call: async (method, args) => (method === "project:recent" ? [] : { path: args?.[0] }), snapshot: async (p) => snapshot(p) });
  await render().connect({ address: "address", token: "token" });
  await render().open("A");
  const first = render();
  assert.equal(first.isSelected(), true);
  await first.open("B");
  assert.equal(first.isSelected(), false);
  const second = render();
  assert.equal(second.isSelected(), true);
  await second.connect({ address: "another-address", token: "token" });
  assert.equal(second.isSelected(), false);
});

test("attachment drafts survive a failed send and move only after a successful first send", async () => {
  const screen = chatHost();
  const photo = { id: "photo", name: "photo.jpg", uri: "file:///photo", image: { id: "photo", name: "photo.jpg", dataUrl: "data:image/jpeg;base64,/9j/" } };
  screen.session.attachments["/p#new:1"] = [photo];
  screen.send();
  screen.sending.reject(new Error("Connection lost"));
  await settle();
  assert.equal(screen.session.attachments["/p#new:1"][0].id, "photo");
  assert.equal(screen.field().value, "first message");
  const next = chatHost();
  next.session.attachments["/p#new:1"] = [photo];
  next.send();
  next.session.attachments["/p#new:1"] = [photo, { ...photo, id: "later" }];
  next.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(next.session.attachments["/p#new:1"], undefined);
  assert.deepEqual(
    Array.from(next.session.attachments["/p#42"], (item) => item.id),
    ["later"],
  );
});

test("reusing an empty Chat preserves its existing text and attachment drafts", async () => {
  const screen = chatHost();
  const photo = { id: "a", name: "a.jpg", uri: "file:///a", image: { id: "a", name: "a.jpg", dataUrl: "data:image/jpeg;base64,/9j/" } };
  screen.session.attachments["/p#42"] = [photo];
  screen.session.drafts["/p#42"] = "unsent in existing Chat";
  screen.send();
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.session.attachments["/p#42"].length, 1);
  assert.equal(screen.session.attachments["/p#42"][0], photo);
  assert.equal(screen.field().value, "unsent in existing Chat");
});

test("notification navigation reconnects and opens the target Chat only after loading current state", async () => {
  const calls = [];
  const target = { project: { path: "/target", name: "Target", state: { sessions: { 7: { id: 7 } } } }, runs: { runs: {} } };
  const render = sessionHost({
    url: "https://mac.example",
    call: async (method, args) => {
      calls.push({ method, args });
      return method === "project:recent" ? [] : method === "project:open" ? { path: args[0] } : {};
    },
    snapshot: async () => target,
  });
  const opened = await render().openNotificationTarget({ address: "https://mac.example", token: "a".repeat(64), name: "Mac" }, "/target", 7);
  assert.equal(opened, true);
  assert.equal(render().snapshot.project.path, "/target");
  assert.equal(render().hostName, "Mac");
  assert.ok(calls.some((call) => call.method === "project:open" && call.args[0] === "/target"));
});

test("a later disconnect or navigation cancels an outstanding notification target", async () => {
  const loaded = deferred();
  const render = sessionHost({ url: "https://mac.example", call: async () => [], snapshot: () => loaded.promise });
  const opening = render().openNotificationTarget({ address: "https://mac.example", token: "a".repeat(64), name: "Mac" }, "/target", 7);
  await new Promise((resolve) => setTimeout(resolve, 1));
  render().cancelNavigation();
  loaded.resolve({ project: { path: "/target", state: { sessions: { 7: { id: 7 } } } } });
  assert.equal(await opening, false);
  assert.equal(render().client, null);
  assert.equal(render().snapshot, null);
});

test("notification navigation rejects a Chat that no longer exists", async () => {
  const render = sessionHost({ call: async () => [], snapshot: async () => snapshot("/target") });
  await assert.rejects(
    render().openNotificationTarget({ address: "https://mac.example", token: "a".repeat(64), name: "Mac" }, "/target", 7),
    /no longer available/,
  );
  assert.equal(render().client, null);
});

test("a cancelled notification target ignores a later network failure", async () => {
  const loaded = deferred();
  const render = sessionHost({ call: async () => [], snapshot: () => loaded.promise });
  const opening = render().openNotificationTarget({ address: "https://mac.example", token: "a".repeat(64), name: "Mac" }, "/target", 7);
  await new Promise((resolve) => setTimeout(resolve, 1));
  render().cancelNavigation();
  loaded.reject(new Error("Connection lost"));
  assert.equal(await opening, false);
});

function pushHost(t, initial = "index") {
  const react = hookHost();
  react.useEffect = react.effect;
  react.useLayoutEffect = react.effect;
  const { StackRouter, StackActions } = require(
    require.resolve("expo-router/build/react-navigation/routers", { paths: [path.join(__dirname, "../apps/mobile")] }),
  );
  const stack = StackRouter({ initialRouteName: initial });
  const options = { routeNames: ["index", "projects", "project", "chat"], routeParamList: {}, routeGetIdList: {} };
  let navigation = stack.getInitialState(options);
  let pathname = initial === "index" ? "/" : "/chat";
  let params = initial === "chat" ? { id: "1" } : {};
  const apply = (action) => {
    navigation = stack.getStateForAction(navigation, action, options) || navigation;
  };
  const router = {
    dismissAll: () => apply(StackActions.popToTop()),
    replace: (route) => apply(StackActions.replace(route.pathname.slice(1), route.params)),
    dismissTo: (path) => apply(StackActions.popTo(path === "/" ? "index" : path.slice(1))),
    push: (route) => apply(StackActions.push(typeof route === "string" ? route.slice(1) : route.pathname.slice(1), route.params)),
  };
  let generation = 0,
    receive;
  const opening = deferred(),
    opens = [];
  const host = { id: "https://mac.example", address: "https://mac.example", token: "a".repeat(64), name: "Mac", lastUsed: 0 };
  const session = {
    booted: true,
    hosts: [host],
    snapshot: snapshot("/project"),
    client: { url: host.id },
    claimAutoOpen() {},
    cancelNavigation() {
      generation++;
    },
    navigationVersion: () => generation,
    openNotificationTarget: async (...args) => {
      const current = ++generation;
      opens.push(args);
      await opening.promise;
      return current === generation;
    },
  };
  const { usePushState } = load(
    "push.tsx",
    {
      react,
      "react/jsx-runtime": { jsx },
      "react-native": { Alert: { alert() {} }, AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } },
      "expo-router": { router, usePathname: () => pathname, useGlobalSearchParams: () => params },
      "./client": {},
      "./relay-native": { relayRuntime: {} },
      "./routes-native": routesNative(),
      "./hosts-native": { savedHosts: { list: async () => [host] } },
      "./session": { useSession: () => session },
      "./push-controller": require("../apps/mobile/src/push-controller.ts"),
      "./push-native": {
        pushStore: { read: async () => ({ enabled: false, pending: [] }) },
        pushNative: {
          available: () => "Simulator",
          listen: async (_view, tap) => {
            receive = tap;
            return () => {};
          },
        },
      },
    },
    "\nexport { usePushState };",
  );
  const render = () => {
    react.begin();
    const value = usePushState();
    react.flush();
    return value;
  };
  t.after(() => react.cleanup());
  render();
  return {
    render,
    opens,
    opening,
    tap: (eventId = "event") => {
      receive({ kind: "milagre-chat", hostId: host.id, projectPath: "/project", sessionId: 2, eventId });
      render();
    },
    switchChat: (id, projectPath, hostId) => {
      params = { id, projectPath, hostId };
      pathname = "/chat";
      render();
    },
    routes: () => navigation.routes,
    back: () => apply({ type: "GO_BACK" }),
    pair: () => {
      const current = ++generation;
      pathname = "/pair";
      params = {};
      render();
      return current === generation;
    },
  };
}

test("a same-screen Chat switch cancels a slow notification target", async (t) => {
  const screen = pushHost(t, "chat");
  screen.tap();
  await settle();
  screen.switchChat("3");
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes()[0].name, "chat");
  assert.equal(screen.routes()[0].params, undefined);
});

test("switching Projects with the same Chat id cancels a slow notification target", async (t) => {
  const screen = pushHost(t, "chat");
  screen.tap();
  await settle();
  screen.switchChat("1", "/another-project", "https://mac.example");
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes()[0].params, undefined);
});

test("a cold-start notification opens the target directly without setup screens", async (t) => {
  const screen = pushHost(t);
  screen.tap();
  await settle();
  screen.opening.resolve();
  await settle();
  assert.deepEqual(
    screen.routes().map((route) => route.name),
    ["chat"],
  );
  assert.equal(screen.routes()[0].params.projectPath, "/project");
  assert.equal(screen.routes()[0].params.hostId, "https://mac.example");
});

test("duplicate in-flight taps share one opening and a later tap can open again", async (t) => {
  const screen = pushHost(t);
  screen.tap();
  await settle();
  screen.tap();
  await settle();
  assert.equal(screen.opens.length, 1);
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes().at(-1).name, "chat");
  screen.tap();
  await settle();
  assert.equal(screen.opens.length, 2);
});

test("route changes preserve a newer normal pairing while cancelling notification work", async (t) => {
  const screen = pushHost(t);
  assert.equal(screen.pair(), true);
  screen.tap();
  await settle();
  assert.equal(screen.pair(), true);
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes().at(-1).name, "index");
});

test("a notification target clears an older Project loading state", async () => {
  const oldOpening = deferred();
  const render = sessionHost({
    call: async (method, args) =>
      method === "project:recent" ? [] : method === "project:open" ? (args[0] === "/old" ? oldOpening.promise : { path: args[0] }) : {},
    snapshot: async (projectPath) => ({ ...snapshot(projectPath), project: { path: projectPath, state: { sessions: { 2: { id: 2 } } } } }),
  });
  await render().connect({ address: "address", token: "token" });
  const old = render().open("/old");
  assert.equal(render().opening.path, "/old");
  await render().openNotificationTarget({ address: "new", token: "new", name: "Mac" }, "/target", 2);
  oldOpening.resolve({ path: "/old" });
  await old;
  assert.equal(render().snapshot.project.path, "/target");
  assert.equal(render().opening, null);
});

// Render the real activity adapters, disclosure and shimmer against native leaves.
function activityItemHost() {
  const hosts = new Map();
  let current;
  const react = Object.fromEntries(["useState", "useRef", "useMemo", "useEffect"].map((name) => [name, (...args) => current[name](...args)]));
  react.memo = (fn) => fn;
  const palette = { ink: "#fff", ink2: "#aaa", ink3: "#666", field: "#222", red: "#f00", orange: "#f80" };
  const native = {
    Text: "Text",
    View: "View",
    Pressable: "Pressable",
    useColorScheme: () => "dark",
    AccessibilityInfo: {},
    StyleSheet: { create: (value) => value, absoluteFill: {} },
    Animated: {
      Value: class {
        interpolate() {}
      },
      View: "AnimatedView",
    },
    Easing: { bezier: () => () => {}, linear() {} },
  };
  const icons = new Proxy({}, { get: (_, key) => key });
  const common = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": native,
    "@hugeicons/core-free-icons": icons,
    "@milagre/shared/reply-parts": require("@milagre/shared/reply-parts"),
    "./icons": { Icon: "Icon", SpinnerRing: "SpinnerRing" },
    "./ui": { colors: palette, styles: { code: {}, caption: {}, label: {}, muted: {} }, PageScroll: "ScrollView" },
  };
  const running = load("running-logo.tsx", {
    ...common,
    "react-native-svg": { default: "Svg", Path: "Path" },
    "@react-native-masked-view/masked-view": { __esModule: true, default: "MaskedView" },
    "expo-linear-gradient": { LinearGradient: "LinearGradient" },
    "expo-router": { useIsFocused: () => false },
    "./logo": { LEFT: "", RIGHT: "", STAR: "", STAR_BOX: {} },
    "./theme": { colors: palette, fonts: { mono: "mono" }, hex: () => palette },
  });
  const shared = load("activity-item.tsx", { ...common, "./running-logo": running, "./theme": { fonts: { mono: "mono" } } });
  const SubagentItem = load("subagent-item.tsx", { ...common, "./activity-item": shared }).SubagentItem;
  const ToolRow = load("tool-row.tsx", {
    ...common,
    "./activity-item": shared,
    "./markdown": { Markdown: ({ text }) => jsx("Text", { children: text }) },
  }).ToolRow;
  function visit(node, key) {
    if (Array.isArray(node)) return node.map((child, index) => visit(child, `${key}.${child?.props?.id || index}`));
    if (!node || typeof node !== "object" || !node.type) return node;
    if (typeof node.type === "function") {
      current = hosts.get(key) || hookHost();
      hosts.set(key, current);
      current.begin();
      return visit(node.type(node.props), `${key}.render`);
    }
    return { ...node, props: { ...node.props, children: visit(node.props?.children, `${key}.children`) } };
  }
  return { subagent: (agent) => visit(jsx(SubagentItem, { agent }), "agent"), tool: (props) => visit(jsx(ToolRow, props), "tool") };
}
const sampleSubagent = {
  id: "a",
  title: "Check the phone connection",
  status: "running",
  startedAt: 1,
  updatedAt: 1,
  latestActivity: "Checking pairing",
  transcript: [{ id: "t", kind: "message", text: "Connection verified." }],
};

test("subagent execution shimmers, while waiting, failure and completion stop it", () => {
  const item = activityItemHost();
  for (const status of ["initializing", "running"])
    assert.ok(
      find(item.subagent({ ...sampleSubagent, status }), (node) => node.type === "MaskedView"),
      status,
    );
  for (const status of ["waiting", "failed", "completed", "cancelled"])
    assert.equal(
      find(item.subagent({ ...sampleSubagent, status }), (node) => node.type === "MaskedView"),
      undefined,
      status,
    );
});

test("subagent details stay expanded across live updates and collapse through the disclosure", () => {
  const item = activityItemHost();
  let tree = item.subagent(sampleSubagent);
  assert.equal(
    find(tree, (node) => node.type === "Text" && node.props.children === "Connection verified."),
    undefined,
  );
  find(tree, (node) => node.props?.accessibilityRole === "button").props.onPress();
  tree = item.subagent({ ...sampleSubagent, status: "completed", transcript: [{ id: "t", kind: "message", text: "New live output" }] });
  assert.ok(find(tree, (node) => node.type === "Text" && node.props.children === "New live output"));
  assert.equal(find(tree, (node) => node.props?.accessibilityRole === "button").props.accessibilityState.expanded, true);
  find(tree, (node) => node.props?.accessibilityRole === "button").props.onPress();
  assert.equal(
    find(item.subagent(sampleSubagent), (node) => node.type === "Text" && node.props.children === "Connection verified."),
    undefined,
  );
});

test("tool disclosure reveals late output, while its chat action opens Activity without expanding", () => {
  const item = activityItemHost();
  const props = { step: { id: "s", kind: "shell", title: "Ran `npm test`", status: "running", hasDetail: true }, live: false, waiting: false };
  let tree = item.tool(props);
  find(tree, (node) => node.props?.accessibilityRole === "button").props.onPress();
  assert.ok(find(item.tool(props), (node) => node.type === "Text" && node.props.children === "Loading output…"));
  tree = item.tool({ ...props, step: { ...props.step, detail: "51 tests passed", status: "done" }, live: false });
  assert.ok(find(tree, (node) => node.type === "Text" && node.props.children === "51 tests passed"));
  assert.equal(
    find(tree, (node) => node.type === "MaskedView"),
    undefined,
  );
  let opened = 0;
  const navigated = activityItemHost();
  tree = navigated.tool({
    ...props,
    step: { ...props.step, detail: "Tool output" },
    onPress: () => {
      opened++;
    },
  });
  find(tree, (node) => node.props?.accessibilityRole === "button").props.onPress();
  assert.equal(opened, 1);
  assert.equal(
    find(navigated.tool({ ...props, onPress: () => {} }), (node) => node.type === "ScrollView"),
    undefined,
  );
});

function updatesHost() {
  const react = hookHost();
  const listeners = new Set();
  const state = { status: "idle", error: "" };
  const appState = {
    currentState: "active",
    addEventListener: (_, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  let reloads = 0,
    retries = 0;
  const { UpdateSheet, useUpdatePresentation } = load("update-sheet.tsx", {
    react: { ...react, useEffect: react.effect, useSyncExternalStore: (_, get) => get() },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Text: "Text", Modal: "Modal", ActivityIndicator: "ActivityIndicator", useColorScheme: () => "dark", AppState: appState },
    "expo-router": {},
    "expo-updates": {},
    "./update-controller": {},
    "./theme": { colors: {}, hex: () => ({ page: "#17181a" }) },
    "./ui": { PillButton: "PillButton" },
  });
  return {
    set(status, error = "") {
      state.status = status;
      state.error = error;
    },
    render() {
      react.begin();
      useUpdatePresentation(state);
      react.flush();
      react.begin();
      useUpdatePresentation(state);
      react.begin();
      const presentation = useUpdatePresentation(state);
      const content = UpdateSheet({
        state,
        onUpdate: () => {
          reloads++;
        },
        onRetry: () => {
          retries++;
        },
        onDismiss: presentation.dismiss,
      });
      return { ...presentation, content };
    },
    foreground() {
      appState.currentState = "active";
      for (const listener of listeners) listener("active");
    },
    background() {
      appState.currentState = "background";
      for (const listener of listeners) listener("background");
    },
    cleanup: react.cleanup,
    listeners,
    reloads: () => reloads,
    retries: () => retries,
  };
}

test("the update sheet opens only for an actionable update and Later lasts until foreground entry", () => {
  const host = updatesHost();
  for (const status of ["idle", "checking", "downloading", "up-to-date", "disabled"]) {
    host.set(status);
    assert.equal(host.render().presented, false, status);
  }
  host.set("ready");
  const ready = host.render();
  assert.equal(ready.presented, true);
  find(ready.content, (node) => node.type === "PillButton" && node.props.title === "Later").props.onPress();
  assert.equal(host.render().presented, false);
  host.background();
  assert.equal(host.render().presented, false);
  host.foreground();
  assert.equal(host.render().presented, true);
  host.render().dismiss();
  assert.equal(host.render().presented, false, "swipe dismissal behaves like Later");
  assert.equal(host.reloads(), 0);
  host.cleanup();
  assert.equal(host.listeners.size, 0);
});

test("an update downloaded in the background waits until foreground entry to present", () => {
  const host = updatesHost();
  host.render();
  host.background();
  host.set("ready");
  assert.equal(host.render().presented, false);
  host.foreground();
  assert.equal(host.render().presented, true);
  host.cleanup();
});

test("Later during retry stays dismissed when the download finishes or polling fails", () => {
  for (const final of ["ready", "error"]) {
    const host = updatesHost();
    host.set("error");
    host.render();
    host.set("downloading");
    find(host.render().content, (node) => node.type === "PillButton" && node.props.title === "Later").props.onPress();
    host.set(final);
    assert.equal(host.render().presented, false);
    host.foreground();
    assert.equal(host.render().presented, true);
    host.cleanup();
  }
});

test("sheet actions apply or retry, keep progress visible, and recover from reload errors", () => {
  const host = updatesHost();
  host.set("error", "Could not download the update. Try again.");
  assert.equal(host.render().presented, true);
  find(host.render().content, (node) => node.type === "PillButton" && node.props.title === "Try again").props.onPress();
  assert.equal(host.retries(), 1);
  for (const status of ["checking", "downloading"]) {
    host.set(status);
    const progress = host.render();
    assert.equal(progress.presented, true);
    assert.ok(find(progress.content, (node) => node.type === "ActivityIndicator"));
    assert.equal(
      find(progress.content, (node) => node.type === "PillButton" && node.props.title === "Try again"),
      undefined,
    );
  }
  host.set("ready");
  find(host.render().content, (node) => node.type === "PillButton" && node.props.title === "Update now").props.onPress();
  assert.equal(host.reloads(), 1);
  host.set("restarting");
  assert.ok(find(host.render().content, (node) => node.type === "ActivityIndicator"));
  assert.equal(
    find(host.render().content, (node) => node.type === "PillButton"),
    undefined,
  );
  host.set("ready", "Could not apply the update. Try again.");
  const failed = host.render();
  assert.ok(find(failed.content, (node) => node.props?.accessibilityRole === "alert"));
  find(failed.content, (node) => node.type === "PillButton" && node.props.title === "Try again").props.onPress();
  assert.equal(host.reloads(), 2);
  assert.equal(host.retries(), 1, "a reload failure must retry the downloaded update");
  host.cleanup();
});

test("the global shell waits for navigation, pushes once, and preserves each current page", () => {
  const react = hookHost();
  let created = 0,
    navigation;
  const routes = [],
    resets = [];
  let latestTree;
  let navigationListener;
  const navigationRef = {
    getRootState: () => ({ key: "generated-root", routes: [{ name: "__root", state: navigation }] }),
    addListener: (_, listener) => {
      navigationListener = listener;
      return () => {
        navigationListener = undefined;
      };
    },
    dispatch: (action) => {
      assert.equal(action.target, "root");
      resets.push(action.payload);
      navigation = action.payload;
    },
  };
  const state = { status: "ready", error: "" };
  const shell = load(
    "update-sheet.tsx",
    {
      react: { ...react, useEffect: react.effect, createContext: () => ({ Provider: "UpdatesProvider" }), useSyncExternalStore: (_, get) => get() },
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } },
      "expo-router": {
        router: { push: (route) => routes.push(route) },
        useRootNavigationState: () => navigation,
        useNavigationContainerRef: () => navigationRef,
      },
      "expo-updates": { isEnabled: true, useUpdates: () => ({}) },
      "./update-controller": {
        watchUpdates: () => () => {},
        createUpdateController: () => {
          created++;
          return { subscribe() {}, get: () => state, install() {}, check() {}, syncNative() {} };
        },
      },
      "./theme": { colors: {} },
      "./ui": {},
    },
    "\nconst __DEV__ = false;",
  ).UpdateShell;
  for (const page of ["Computers", "Chat", "Settings"]) {
    react.begin();
    const navigator = jsx("Stack", { page });
    const tree = (latestTree = shell({ children: navigator }));
    assert.equal(tree.props.children, navigator);
    assert.equal(tree.props.value.state, state);
    react.flush();
    if (!navigation) {
      assert.deepEqual(routes, []);
      navigation = { key: "root", routeNames: ["index", "update-sheet", "projects"], index: 0, routes: [{ key: "computers", name: "index" }] };
      navigationListener();
    }
  }
  assert.equal(created, 1, "navigation keeps one update controller");
  assert.deepEqual(routes, ["/update-sheet"], "pending updates push one sheet above the current route");
  const updateRoute = { key: "pending-update", name: "update-sheet" };
  const destination = { key: "connected-projects", name: "projects", params: { host: "saved" } };
  navigation = { ...navigation, index: 2, routes: [...navigation.routes, updateRoute, destination] };
  navigationListener();
  react.begin();
  shell({ children: jsx("Stack", {}) });
  react.flush();
  assert.equal(resets.length, 1);
  assert.equal(navigation.index, 2);
  assert.equal(navigation.routes[1], destination, "late navigation retains the destination and its params");
  assert.equal(navigation.routes[2].name, "update-sheet");
  assert.equal(navigation.routes.filter((route) => route.name === "update-sheet").length, 1, "late navigation retains one prompt");
  react.begin();
  shell({ children: jsx("Stack", {}) });
  react.flush();
  navigationListener();
  assert.equal(resets.length, 1, "the focused sheet does not reset navigation again");
  navigation = { ...navigation, index: 0, routes: [navigation.routes[0]] };
  navigationListener();
  assert.equal(routes.length, 2, "a notification reset restores the pending prompt");
  latestTree.props.value.dismiss();
  navigationListener();
  assert.equal(routes.length, 2, "explicit dismissal stops navigation from reopening the prompt");
  react.cleanup();
  assert.equal(navigationListener, undefined);
});

test("Later, swipe and Android back defer; notification reset and route replacement do not", () => {
  const react = hookHost();
  let dismissals = 0,
    backs = 0,
    beforeRemove;
  const dismiss = () => {
    dismissals++;
  };
  const navigation = {
    addListener: (_, listener) => {
      beforeRemove = listener;
      return () => {
        beforeRemove = undefined;
      };
    },
  };
  const state = { status: "ready", error: "" };
  const route = load("app/update-sheet.tsx", {
    react: { ...react, useEffect: react.effect },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-router": {
      router: {
        back: () => {
          backs++;
        },
      },
      useNavigation: () => navigation,
    },
    "../update-sheet": { UpdateSheet: "UpdateSheet", useAppUpdates: () => ({ state, check() {}, install() {}, dismiss }) },
  }).default;
  react.begin();
  const tree = route();
  react.flush();
  for (const type of ["RESET", "POP_TO"]) beforeRemove({ data: { action: { type } } });
  assert.equal(dismissals, 0, "programmatic navigation keeps the prompt pending");
  for (const type of ["GO_BACK", "POP"]) beforeRemove({ data: { action: { type } } });
  assert.equal(dismissals, 2);
  tree.props.onDismiss();
  assert.equal(backs, 1);
  assert.equal(dismissals, 3, "Later defers before removing its route");
  state.status = "restarting";
  react.begin();
  route();
  react.flush();
  assert.equal(dismissals, 3);
  react.cleanup();
  assert.equal(dismissals, 3, "replacing a native sheet route does not defer the prompt");
  assert.equal(beforeRemove, undefined);
});

test("a live turn's step whose output the phone left out does not expand, while saved and clipped steps do", () => {
  const pending = "Output appears when the turn finishes.";
  const note = (tree) => find(tree, (node) => node.type === "Text" && node.props.children === pending);
  const button = (tree) => find(tree, (node) => node.props?.accessibilityRole === "button");
  const step = { id: "s", kind: "shell", title: "Ran `npm test`", status: "done", hasDetail: true };
  // Live and slimmed: a muted line, no disclosure, and nothing that loads.
  const item = activityItemHost();
  let tree = item.tool({ step, live: true, waiting: false });
  assert.ok(note(tree));
  assert.equal(button(tree), undefined, "not expandable");
  assert.equal(
    find(tree, (node) => node.type === "Text" && node.props.children === "Loading output…"),
    undefined,
  );
  // In the chat the row opens Activity, which says it, so the chat row stays as it was.
  const chat = activityItemHost().tool({ step, live: true, waiting: false, onPress: () => {} });
  assert.equal(note(chat), undefined);
  // Live with its clipped tail kept: expands and shows it.
  const kept = activityItemHost();
  tree = kept.tool({ step: { ...step, hasDetail: undefined, detail: "…tail of the log" }, live: true, waiting: false });
  assert.equal(note(tree), undefined);
  button(tree).props.onPress();
  assert.ok(
    find(
      kept.tool({ step: { ...step, hasDetail: undefined, detail: "…tail of the log" }, live: true, waiting: false }),
      (node) => node.type === "Text" && node.props.children === "…tail of the log",
    ),
  );
  // Saved message: hasDetail still means "fetch", shown as loading while it does.
  const saved = activityItemHost();
  tree = saved.tool({ step, live: false, waiting: false });
  assert.equal(note(tree), undefined);
  button(tree).props.onPress();
  assert.ok(find(saved.tool({ step, live: false, waiting: false }), (node) => node.type === "Text" && node.props.children === "Loading output…"));
});

test("relay transports: one per Mac, replaced by a new code, closed in the background and on forget", async () => {
  const listeners = [],
    made = [];
  const identity = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
  const phoneRandom = (n) => new Uint8Array(n);
  const { relayRuntime } = load("relay-native.ts", {
    "react-native": {
      AppState: {
        addEventListener: (_event, listener) => {
          listeners.push(listener);
          return { remove() {} };
        },
      },
    },
    // oxlint-disable-next-line typescript/no-extraneous-class -- empty classes stub expo-file-system constructors in the test
    "expo-file-system": { Directory: class {}, File: class {}, Paths: {} },
    "./relay-transport": {
      createRelayTransport: (options) => {
        const transport = {
          options,
          closed: 0,
          close() {
            transport.closed++;
          },
        };
        made.push(transport);
        return transport;
      },
    },
    "./phone-identity": { phoneIdentity: async () => identity, phoneRandom },
    "./routes-native": routesNative(),
  });
  const link = (hostId, key = "K".repeat(43)) => ({ url: "wss://relay.milagre.cloud", hostId, key });
  const a = await relayRuntime.transport({ relay: link("A".repeat(22)), token: "a".repeat(64) });
  assert.equal(await relayRuntime.transport({ relay: link("A".repeat(22)), token: "a".repeat(64) }), a, "one transport per Mac");
  assert.equal(a.options.identity, identity);
  assert.equal(a.options.random, phoneRandom);
  assert.equal(a.options.hostId, "A".repeat(22));
  const b = await relayRuntime.transport({ relay: link("B".repeat(22)), token: "a".repeat(64) });
  assert.notEqual(b, a);
  // A new pairing code for the same Mac replaces its transport.
  const a2 = await relayRuntime.transport({ relay: link("A".repeat(22)), token: "c".repeat(64) });
  assert.notEqual(a2, a);
  assert.equal(a.closed, 1);
  // The background closes every open transport; they stay in place to reopen on the next request.
  for (const listener of listeners) listener("inactive");
  assert.deepEqual([a2.closed, b.closed], [0, 0]);
  for (const listener of listeners) listener("background");
  assert.deepEqual([a2.closed, b.closed], [1, 1]);
  assert.equal(await relayRuntime.transport({ relay: link("B".repeat(22)), token: "a".repeat(64) }), b);
  // Forget closes the transport and drops it: the next use builds a new one.
  relayRuntime.forget("B".repeat(22));
  assert.equal(b.closed, 2);
  const b2 = await relayRuntime.transport({ relay: link("B".repeat(22)), token: "a".repeat(64) });
  assert.notEqual(b2, b);
  relayRuntime.forget("nobody");
  for (const listener of listeners) listener("background");
  assert.equal(b.closed, 2, "a forgotten transport is not closed again");
});

test("refreshing saved hosts during startup cannot cancel the claimed auto-open", async () => {
  const react = hookHost();
  react.useEffect = react.effect;
  const host = { id: "mac", address: "mac", name: "Mac", token: "token" };
  const opened = [],
    routes = [];
  let claimed = false;
  const session = {
    booted: true,
    hosts: [host],
    lastLocation: { hostId: "mac", projectPath: "/p", chatId: 1 },
    client: null,
    loadHosts: async () => [host],
    connect: async (value) => {
      opened.push(value.id);
      return true;
    },
    claimAutoOpen: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    navigationVersion: () => 0,
  };
  const { default: Screen } = load("app/index.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Alert: {}, Platform: { OS: "ios" }, RefreshControl: "RefreshControl", Text: "Text", View: "View" },
    "expo-router": {
      Stack: { Screen: "Screen", Toolbar: Object.assign(() => null, { Button: "Button", Spacer: "Spacer" }) },
      router: { replace: (route) => routes.push(route) },
      useFocusEffect() {},
    },
    "@hugeicons/core-free-icons": {},
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
    "../session": { useSession: () => session },
    "../push": { usePush: () => ({}) },
    "../hosts-native": { savedHosts: {} },
    "../confirm-store": { confirmSheet() {} },
    "../client": {},
    "../relay-native": {},
    "../routes-native": routesNative(),
    "../icons": { Icon: "Icon" },
    "../ui": { colors: {}, styles: {}, ErrorNotice: "ErrorNotice", ListRow: "ListRow", PageScroll: "PageScroll" },
  });
  react.begin();
  Screen();
  react.flush();
  session.hosts = [...session.hosts];
  react.begin();
  Screen();
  react.flush();
  await settle();
  assert.deepEqual(opened, ["mac"]);
  assert.equal(routes[0].pathname, "/projects");
  assert.equal(routes[0].params.resume, "1");
  react.cleanup();
});

test("first send immediately shows input and a running Chat in the drawer before uploads or setup finish", async () => {
  const upload = deferred(),
    creating = deferred();
  const screen = chatHost({ effects: true, call: (method) => (method === "project:branches" ? Promise.resolve(["main"]) : creating.promise) });
  screen.session.client.upload = () => upload.promise;
  screen.session.attachments["/p#new:1"] = [{ id: "file", name: "notes.txt", uri: "file:///phone/notes.txt", base64: "Zm9v" }];
  find(screen.render(), (node) => node.type === "PullDown" && node.props.label === "Choose isolation").props.onSelect("worktree");
  await settle();
  screen.send();
  assert.equal(screen.field().value, "", "clear the composer before the first await");
  const reply = find(screen.render(), (node) => node.type === "ChatReply" && node.props.message?.role === "user");
  assert.equal(reply.props.message.body, "first message");
  assert.deepEqual(Array.from(reply.props.message.files), ["notes.txt"]);
  assert.ok(find(screen.render(), (node) => node.type === "ThinkingIndicator"));
  const nav = navigationHost(Promise.resolve(), { session: { ...screen.session, recent: [{ path: "/p" }] } });
  const row = nav.rows().props.data.find((row) => row.kind === "chat");
  assert.equal(row.chat.title, "first message");
  assert.equal(row.mark, "running");
  nav.open(nav.row("chat")).props.onPress();
  assert.equal(nav.routes[0].params.worktreeId, "1");
  assert.equal(nav.routes[0].params.id, undefined, "a preview never opens a negative host Chat id");
  screen.field().onChangeText("next draft");
  upload.resolve({ path: "/p/notes.txt" });
  await settle();
  assert.equal(screen.calls.filter((call) => call.method === "worktree:create").length, 1);
  creating.reject(new Error("Setup failed"));
  await settle();
  assert.equal(screen.field().value, "first message\n\nnext draft");
  assert.equal(screen.session.attachments["/p#new:1"][0].id, "file");
  nav.session.pendingChats = screen.session.pendingChats;
  assert.equal(nav.rows().props.data.filter((row) => row.kind === "chat").length, 0, "failed preparation removes its drawer preview");
});

test("canonical mobile input replaces the preview before acknowledgement and keeps the next draft", async () => {
  const sending = deferred();
  const screen = chatHost({ effects: true, call: (method) => (method === "project:branches" ? Promise.resolve(["main"]) : sending.promise) });
  screen.send();
  await settle();
  screen.field().onChangeText("next draft");
  const request = screen.calls.find((call) => call.method === "chat:send").args[0];
  const state = screen.session.snapshot.project.state;
  state.sessions[7] = { id: 7, worktree_id: 1, agent_name: "main", title: "first message", status: "Created" };
  state.messages = [{ id: 8, session_id: 7, role: "user", body: "first message", context: null, clientMessageId: request.clientMessageId }];
  const nav = navigationHost(Promise.resolve(), { session: { ...screen.session, recent: [{ path: "/p" }] } });
  assert.equal(nav.rows().props.data.filter((row) => row.kind === "chat").length, 1);
  assert.equal(nav.rows().props.data.find((row) => row.kind === "chat").chat.id, 7);
  assert.equal(find(screen.render(), (node) => node.type === "ChatReply" && node.props.message?.role === "user").props.message.id, 8);
  sending.resolve({ sessionId: 7 });
  await settle();
  assert.equal(screen.params.id, "7");
  assert.equal(screen.field().value, "next draft");
});

test("mobile keeps an acknowledged Chat preview until its own host snapshot contains the input", () => {
  const { createPendingChat } = require("@milagre/shared/chats");
  const state = { next_id: 4, projects: {}, worktrees: {}, sessions: {}, messages: [], tasks: {} };
  const preview = createPendingChat({ state, worktreeId: 1, body: "Hello", provider: "codex", model: "m" });
  const provider = sessionHost({});
  const props = { hostId: "mac", snapshot: { project: { path: "/p", state } } };
  provider.pending(props).setPendingChats(() => ({ first: { preview, hostId: "mac", projectPath: "/p", accepted: false } }));
  const saved = { ...state, messages: [{ ...preview.message, id: 8, session_id: 7 }] };
  const updated = { ...props, snapshot: { project: { path: "/p", state: saved } } };
  assert.ok(provider.pending(updated).pendingChats.first, "live input alone cannot release a send still awaiting acknowledgement");
  provider.pending(updated).setPendingChats((current) => ({ first: { ...current.first, accepted: true } }));
  assert.ok(provider.pending({ ...updated, hostId: "other" }).pendingChats.first, "another host cannot retire the preview");
  assert.ok(provider.pending(props).pendingChats.first, "acknowledgement alone keeps the preview while the snapshot catches up");
  assert.ok(provider.pending(updated).pendingChats.first, "a returning origin route still needs to adopt its saved Chat");
  provider.pending(updated).setPendingChats((current) => ({ first: { ...current.first, promoted: true } }));
  provider.pending(updated);
  assert.equal(provider.pending(updated).pendingChats.first, undefined);
});

test("reopening a pending mobile Chat adopts its saved id before the preview retires", async () => {
  const sending = deferred();
  const screen = chatHost({ effects: true, call: (method) => (method === "project:branches" ? Promise.resolve(["main"]) : sending.promise) });
  screen.send();
  await settle();
  const request = screen.calls.find((call) => call.method === "chat:send").args[0];
  const state = screen.session.snapshot.project.state;
  state.sessions[2] = { id: 2, worktree_id: 1, provider: "codex", status: "Created" };
  screen.params.id = "2";
  screen.render();
  delete screen.params.id;
  screen.render();
  state.sessions[7] = { id: 7, worktree_id: 1, provider: "codex", status: "Created" };
  state.messages = [{ id: 8, session_id: 7, role: "user", body: "first message", context: null, clientMessageId: request.clientMessageId }];
  sending.resolve({ sessionId: 7 });
  await settle();
  screen.render();
  assert.equal(screen.params.id, "7", "the focused screen adopts its own pending Chat after returning");
  screen.session.pendingChats = {};
  assert.equal(find(screen.render(), (node) => node.type === "ChatReply" && node.props.message?.role === "user").props.message.id, 8);
});

test("an accepted preview cannot assign its Chat id to a different requested Project while that Project loads", () => {
  const screen = chatHost({ effects: true });
  screen.session.open = async () => null;
  const { createPendingChat } = require("@milagre/shared/chats");
  const preview = createPendingChat({ state: screen.session.snapshot.project.state, worktreeId: 1, body: "Hello", provider: "codex", model: "m" });
  screen.session.pendingChats["mac|/p#new:1"] = {
    preview: { ...preview, targetSessionId: 7 },
    hostId: "mac",
    projectPath: "/p",
    originChatId: "/p#new:1",
    originSessionId: null,
    worktreeId: 1,
    newWorktree: false,
    accepted: true,
  };
  screen.params.projectPath = "/other";
  screen.render();
  assert.equal(screen.params.id, undefined);
  assert.equal(screen.session.pendingChats["mac|/p#new:1"].promoted, undefined);
});

function simulatorHost(client, file = "simulator.tsx") {
  const react = hookHost({ effects: true }),
    files = new Map(),
    listeners = new Set();
  const native = {
    useColorScheme: () => "light",
    Text: "Text",
    View: "View",
    Pressable: "Pressable",
    AppState: {
      currentState: "active",
      addEventListener(_name, fn) {
        listeners.add(fn);
        return {
          remove() {
            listeners.delete(fn);
          },
        };
      },
    },
  };
  class File {
    constructor(_cache, name) {
      this.uri = "file:///cache/" + name;
    }
    write(value) {
      files.set(this.uri, value);
    }
    get exists() {
      return files.has(this.uri);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  const source = load(
    file,
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": native,
      "expo-router": { router: { back() {}, push() {} }, useFocusEffect: (fn) => react.effect(fn, [fn]) },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 34 }) },
      "@expo/dom-webview": { DomWebView: "DomWebView" },
      "expo-file-system": { File, Paths: { cache: "/cache" } },
      "expo-clipboard": { setStringAsync: async () => {} },
      "@hugeicons/core-free-icons": {},
      "@milagre/shared/simulator-receiver": require("../packages/shared/src/simulator-receiver.mjs"),
      "./session": { useSession: () => ({ client }) },
      "./icons": { Icon: "Icon" },
      "./theme": {
        hex: () => ({ page: "#fafafb", surface: "#ffffff", ink: "#1f2124", ink2: "#62656b", line: "#ecedef", hover: "#f4f5f6", accent: "#0285ff" }),
      },
      "./ui": { CircleButton: "CircleButton", PageScroll: "PageScroll", PillButton: "PillButton", ErrorNotice: "ErrorNotice", colors: {}, styles: {} },
    },
    file === "simulator.tsx" ? "\nexports.TestSimulatorWebView = SimulatorWebView;" : "",
  );
  return {
    source,
    files,
    background() {
      native.AppState.currentState = "background";
      for (const fn of listeners) fn("background");
    },
    foreground() {
      native.AppState.currentState = "active";
      for (const fn of listeners) fn("active");
    },
    render(name, props) {
      react.begin();
      const tree = source[name](props);
      react.flush();
      return tree;
    },
    cleanup() {
      react.cleanup();
    },
  };
}

test("mobile simulator receiver is an OTA JS string cached locally; backgrounding closes a late open", async () => {
  const gate = deferred(),
    calls = [],
    injected = [];
  const client = {
    call: async (method, args) => {
      calls.push([method, args]);
      return method === "simulator:open" ? gate.promise : null;
    },
  };
  const h = simulatorHost(client);
  h.render("TestSimulatorWebView", { client, deviceId: "sim", chatId: "/p#7" });
  await settle();
  const tree = h.render("TestSimulatorWebView", { client, deviceId: "sim", chatId: "/p#7" });
  assert.equal(tree.type, "DomWebView");
  assert.match(tree.props.source.uri, /^file:\/\/\/cache\//);
  assert.match(h.files.get(tree.props.source.uri), /RTCPeerConnection/);
  assert.equal(tree.props.useExpoModulesBridge, false);
  tree.props.ref.current = { injectJavaScript: (value) => injected.push(value) };
  tree.props.onMessage({ nativeEvent: { data: JSON.stringify({ channel: "milagre-simulator", id: 1, method: "open", args: { deviceId: "sim" } }) } });
  assert.equal(calls.find(([method]) => method === "simulator:open")[1][0].chatId, "/p#7");
  h.background();
  gate.resolve({ viewerId: "late-viewer" });
  await settle();
  assert.ok(injected.some((script) => script.includes("simulatorDispose")));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([method]) => method === "simulator:close"))), ["simulator:close", [{ viewerId: "late-viewer" }]]);
  h.cleanup();
  assert.equal(h.files.size, 0);
});

test("mobile simulator chooses the sole running device, but a list never starts capture", async () => {
  const device = { id: "one", name: "iPhone", platform: "ios", version: "26.2" };
  for (const devices of [[device], [device, { ...device, id: "two" }]]) {
    const calls = [];
    const h = simulatorHost({
      url: "mac",
      call: async (method) => {
        calls.push(method);
        return { chatId: "/p#7", supported: true, devices, attached: devices, available: [] };
      },
    });
    h.render("SimulatorSheet", { hostId: "mac", chatId: "/p#7" });
    await settle();
    const tree = h.render("SimulatorSheet", { hostId: "mac", chatId: "/p#7" });
    assert.equal(tree.props.style.paddingBottom, 34, "controls clear the phone home indicator");
    assert.equal(!!find(tree, (node) => node.props?.deviceId === "one"), devices.length === 1);
    assert.deepEqual(calls, ["simulator:list"]);
    if (devices.length === 2) assert.ok(find(tree, (node) => node.type === "Pressable"));
    h.cleanup();
  }
});

test("simulator sheet preserves its native header and bounds chooser/viewer content below it", async (t) => {
  const device = { id: "one", name: "iPhone", platform: "ios", version: "27" };
  for (const devices of [[device], [device, { ...device, id: "two" }]]) {
    const h = simulatorHost({ url: "mac", call: async () => ({ chatId: "/p#7", supported: true, devices, attached: devices, available: [] }) });
    t.after(() => h.cleanup());
    h.render("SimulatorSheet", { hostId: "mac", chatId: "/p#7" });
    await settle();
    const tree = h.render("SimulatorSheet", { hostId: "mac", chatId: "/p#7" });
    const [header, body] = tree.props.children;
    assert.equal(header.props.collapsable, false, "Fabric must preserve one header view for native sheet sizing");
    assert.equal(header.props.style.flexShrink, 0);
    assert.equal(body.type, "View");
    assert.equal(body.props.collapsable, false);
    assert.equal(body.props.style.flex, 1);
    assert.equal(body.props.style.minHeight, 0);
    const scroll = find(body, (node) => node.type === "PageScroll");
    if (devices.length === 2) {
      assert.equal(scroll.props.contentInsetAdjustmentBehavior, "never", "the body already sits below its own header");
      assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
      assert.equal(scroll.props.style.flex, 1);
    } else
      assert.ok(
        find(body, (node) => node.props?.deviceId === "one"),
        "the live viewer uses the same bounded body",
      );
    h.cleanup();
  }
});

for (const provider of ["claude", "codex"])
  test(`mobile Accounts selects by tapping the row and manages accounts through its menu (${provider})`, async () => {
    const react = hookHost({ effects: true });
    const calls = [];
    const accounts = {
      providers: [
        {
          provider,
          selectedId: "default",
          accounts: [
            { id: "default", provider, label: "Connected CLI account", state: "ready" },
            {
              id: "work",
              provider,
              label: "Work",
              email: "work@example.test",
              plan: provider === "claude" ? "self_serve_business_polite" : "business",
              state: "ready",
            },
          ],
        },
      ],
    };
    const session = {
      hostName: "Preview Mac",
      refreshProviders: async () => {
        calls.push(["refreshProviders"]);
      },
      client: {
        call: async (method, args = []) => {
          calls.push([method, ...args]);
          const group = accounts.providers[0];
          if (method === "accounts:select") group.selectedId = args[1];
          if (method === "accounts:login") group.accounts.find((a) => a.id === args[1]).state = "signing-in";
          if (method === "accounts:cancel") group.accounts.find((a) => a.id === args[1]).state = "signed-out";
          if (method === "accounts:remove") {
            group.accounts = group.accounts.filter((a) => a.id !== args[1]);
            group.selectedId = "default";
          }
          return structuredClone(accounts);
        },
      },
    };
    const { AccountsForComputer: AccountsSection } = load("accounts-section.tsx", {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Text: "Text", View: "View", Pressable: "Pressable" },
      "@hugeicons/core-free-icons": {},
      "@milagre/shared/providers": require("@milagre/shared/providers"),
      "./session": { useSession: () => session },
      "./icons": { ProviderLogo: "ProviderLogo", Icon: "Icon" },
      "./ui": { PillButton: "Button", Field: "Field", IconButton: "IconButton", PullDown: "PullDown", colors: {}, styles: {} },
    });
    const render = () => {
      react.begin();
      return AccountsSection();
    };
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const menu = () => find(render(), (n) => n.type === "PullDown" && n.props.label === "Actions for work@example.test");
    try {
      render();
      await settle();
      const row = find(render(), (n) => n.type === "Pressable" && n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "work@example.test");
      assert.ok(row, "The account row is a directly selectable control");
      assert.match(row.props.accessibilityHint, /^Business account\./);
      assert.equal(JSON.stringify(row).includes("self_serve_business_polite"), false);
      row.props.onPress();
      await settle();
      assert.ok(calls.some((c) => c.join(":") === `accounts:select:${provider}:work`));
      assert.equal(find(render(), (n) => n.props.accessibilityLabel === "work@example.test").props.accessibilityState.checked, true);
      assert.ok(calls.some((c) => c[0] === "refreshProviders"));
      assert.equal(
        find(render(), (n) => n.props.title === "Add account"),
        undefined,
      );
      assert.equal(
        find(render(), (n) => n.type === "Field"),
        undefined,
      );
      assert.equal(
        menu()
          .props.sections.flatMap((s) => s.items.map((i) => i.title))
          .join(","),
        "Re-authenticate,Remove",
      );
      menu().props.onSelect("login");
      await settle();
      assert.ok(calls.some((c) => c.join(":") === `accounts:login:${provider}:work`));
      menu().props.onSelect("cancel");
      await settle();
      assert.ok(calls.some((c) => c.join(":") === `accounts:cancel:${provider}:work`));
      menu().props.onSelect("remove");
      await settle();
      assert.ok(calls.some((c) => c.join(":") === `accounts:remove:${provider}:work`));
      assert.equal(
        find(render(), (n) => n.props.accessibilityLabel === "work@example.test"),
        undefined,
      );
    } finally {
      react.unmount();
    }
  });

function ongoingChatHost(options = {}) {
  const screen = chatHost({ effects: true, ...options });
  screen.params.id = "7";
  const state = screen.session.snapshot.project.state;
  state.sessions[7] = { id: 7, worktree_id: 1, agent_name: "main", title: "Existing Chat", provider: "codex", status: "Idle" };
  state.messages = [
    { id: 2, session_id: 7, role: "user", body: "Original question", context: null },
    { id: 3, session_id: 7, role: "assistant", body: "Previous answer", context: null },
  ];
  screen.session.drafts["/p#7"] = "Follow-up message";
  return screen;
}

function transcriptMessages(screen) {
  const messages = [];
  find(screen.render(), (node) => {
    if (node.type === "ChatReply" && node.props.message) messages.push(node.props.message);
    return false;
  });
  return messages;
}

test("an ongoing mobile Chat shows a follow-up before attachment upload finishes and keeps its history", async () => {
  const upload = deferred();
  const screen = ongoingChatHost();
  screen.session.client.upload = () => upload.promise;
  screen.session.attachments["/p#7"] = [{ id: "file", name: "notes.txt", uri: "file:///notes.txt", base64: "YQ==" }];
  screen.send();
  const messages = transcriptMessages(screen);
  assert.deepEqual(
    messages.map((message) => message.body),
    ["Original question", "Previous answer", "Follow-up message"],
  );
  assert.equal(screen.field().value, "");
  assert.deepEqual(Array.from(messages.at(-1).files), ["notes.txt"]);
  assert.equal(
    screen.calls.some((call) => call.method === "chat:send"),
    false,
    "the preview is visible before uploading or contacting the agent",
  );
  upload.resolve({ path: "/p/notes.txt" });
  await settle();
  const request = screen.calls.find((call) => call.method === "chat:send").args[0];
  assert.equal(request.sessionId, 7);
  assert.equal(request.clientMessageId, messages.at(-1).clientMessageId);
  screen.sending.resolve({ sessionId: 7 });
  await settle();
});

test("an ongoing mobile Chat replaces only the acknowledged follow-up and preserves the next draft", async () => {
  const screen = ongoingChatHost();
  screen.send();
  await settle();
  const preview = transcriptMessages(screen).find((message) => message.body === "Follow-up message");
  assert.ok(preview, "a follow-up renders while the send response is still pending");
  screen.field().onChangeText("Follow-up message");
  const state = screen.session.snapshot.project.state;
  state.messages = [...state.messages, { ...preview, id: 4, session_id: 7 }];
  assert.deepEqual(
    transcriptMessages(screen).map((message) => message.id),
    [2, 3, 4],
    "the canonical message replaces its preview without dropping history or duplicating input",
  );
  screen.sending.resolve({ sessionId: 7 });
  await settle();
  assert.equal(screen.field().value, "Follow-up message", "an intentionally repeated next draft survives acknowledgement");
  assert.equal(screen.params.id, "7");
});

test("a mobile follow-up to a running turn appears immediately and restores text and files after failure", async () => {
  const screen = ongoingChatHost();
  screen.session.snapshot.runs.runs["/p#7"] = { startedAt: Date.now(), questions: [], approvals: [], steps: [], body: "Still working" };
  screen.session.attachments["/p#7"] = [{ id: "file", name: "notes.txt", uri: "file:///notes.txt", path: "/p/notes.txt" }];
  screen.send();
  assert.deepEqual(
    transcriptMessages(screen).map((message) => message.body),
    ["Original question", "Previous answer", "Follow-up message"],
  );
  const order = [];
  find(screen.render(), (node) => {
    if (node.type === "ChatReply") order.push(node.props.run ? "Live reply" : node.props.message.body);
    return false;
  });
  assert.deepEqual(order, ["Original question", "Previous answer", "Live reply", "Follow-up message"], "steering input follows the reply already in progress");
  screen.field().onChangeText("Next draft");
  screen.sending.reject(new Error("Connection lost"));
  await settle();
  assert.deepEqual(
    transcriptMessages(screen).map((message) => message.body),
    ["Original question", "Previous answer"],
  );
  assert.equal(screen.field().value, "Follow-up message\n\nNext draft");
  assert.equal(screen.session.attachments["/p#7"][0].id, "file");
  assert.equal(find(screen.render(), (node) => node.type === "ErrorNotice").props.message, "Connection lost");
});

test("a mobile follow-up keeps the existing Chat in its drawer position", () => {
  const screen = ongoingChatHost();
  const state = screen.session.snapshot.project.state;
  state.next_id = 30;
  state.sessions[20] = { id: 20, worktree_id: 1, agent_name: "main", title: "Newer Chat", status: "Idle" };
  state.messages.push({ id: 21, session_id: 20, role: "user", body: "Newer question", context: null });
  screen.send();
  const nav = navigationHost(Promise.resolve(), { session: { ...screen.session, recent: [{ path: "/p" }] } });
  assert.deepEqual(
    Array.from(
      nav.rows().props.data.filter((row) => row.kind === "chat"),
      (row) => row.chat.id,
    ),
    [20, 7],
  );
});

test("mobile opens a long Chat with its newest 40 messages and loads another page on request", () => {
  const screen = ongoingChatHost();
  screen.session.snapshot.project.state.messages = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1,
    session_id: 7,
    role: index % 2 ? "assistant" : "user",
    body: "Message " + index,
    context: null,
  }));
  assert.equal(transcriptMessages(screen).length, 40);
  assert.equal(transcriptMessages(screen)[0].id, 961);
  find(screen.render(), (node) => node.type === "PillButton" && node.props.title?.startsWith("Show earlier messages")).props.onPress();
  assert.equal(transcriptMessages(screen).length, 80);
  assert.equal(transcriptMessages(screen)[0].id, 921);
  assert.equal(transcriptMessages(screen).at(-1).id, 1000);
});

test("legacy mobile follow-up retires after acceptance and an untagged saved input", async () => {
  const screen = ongoingChatHost();
  screen.session.snapshot.project.state.next_id = 4;
  screen.send();
  await settle();
  const state = screen.session.snapshot.project.state;
  state.messages.push({ id: 4, session_id: 7, role: "user", body: "Follow-up message", context: null });
  screen.sending.resolve({ sessionId: 7 });
  await settle();
  assert.deepEqual(
    transcriptMessages(screen).map((message) => message.id),
    [2, 3, 4],
  );
  const provider = sessionHost({});
  const props = { hostId: "mac", snapshot: screen.session.snapshot };
  provider.pending(props).setPendingChats(() => screen.session.pendingChats);
  provider.pending(props);
  assert.deepEqual(Object.keys(provider.pending(props).pendingChats), []);
});

test("pending snapshot acknowledgement does not disable mobile Stop", async () => {
  const screen = ongoingChatHost();
  screen.session.snapshot.runs.runs["/p#7"] = { startedAt: Date.now(), questions: [], approvals: [], steps: [] };
  screen.send();
  await settle();
  screen.sending.resolve({ sessionId: 7 });
  await settle();
  assert.ok(Object.keys(screen.session.pendingChats).length);
  const stop = find(screen.render(), (node) => node.props?.label === "Stop");
  assert.equal(stop.props.disabled, false);
  stop.props.onPress();
  await settle();
  assert.ok(screen.calls.some((call) => call.method === "agent:interrupt"));
});

test("mobile file attachment chips open their contents", () => {
  const pushed = [];
  const react = hookHost();
  const { FileChip } = load("file-chip.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Pressable: "Pressable", View: "View", Text: "Text" },
    "expo-router": { router: { push: (target) => pushed.push(target) } },
    "./ui": { colors: {} },
  });
  react.begin();
  const chip = FileChip({ path: "/project/ui.tsx" });
  const button = find(chip, (node) => node.type === "Pressable");
  assert.equal(button.props.accessibilityRole, "button");
  button.props.onPress();
  assert.equal(pushed[0].pathname, "/file-preview");
  assert.equal(pushed[0].params.path, "/project/ui.tsx");
});

test("mobile file preview renders text and reports unreadable, empty, and truncated files", () => {
  const react = hookHost();
  let result = { data: null, error: "", refresh() {} };
  const { default: FilePreview } = load("app/file-preview.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    // oxlint-disable-next-line typescript/no-extraneous-class -- empty stub standing in for expo-file-system's File constructor
    "expo-file-system": { File: class {}, FileMode: { ReadOnly: "readOnly" } },
    "react-native": { Platform: { OS: "ios" }, Text: "Text", View: "View" },
    "expo-router": { Stack: { Screen: "Screen" }, useLocalSearchParams: () => ({ path: "/project/ui.tsx" }) },
    "../session": { useSession: () => ({ client: {} }) },
    "../use-rpc": {
      useRpc: (client, method, args) => {
        assert.equal(method, "attachment:preview");
        assert.equal(args[0], "/project/ui.tsx");
        return result;
      },
    },
    "../file-code": { FileCode: "FileCode" },
    "../ui": { colors: {}, styles: {}, ErrorNotice: "ErrorNotice", PageScroll: "PageScroll" },
  });
  const render = () => {
    react.begin();
    return FilePreview();
  };
  const text = (value) => find(render(), (node) => node.type === "Text" && node.props.children === value);
  assert.ok(text("Reading file…"));
  result = { ...result, data: { text: 'export const ui = "hello";', binary: false, truncated: true } };
  assert.equal(find(render(), (node) => node.type === "FileCode").props.text, result.data.text);
  assert.equal(find(render(), (node) => node.type === "FileCode").props.name, "ui.tsx");
  assert.ok(text("Showing the first 256 KB."));
  result = { ...result, data: { text: "", binary: false, truncated: false } };
  assert.ok(text("This file is empty."));
  result = { ...result, data: { text: "", binary: true, truncated: false } };
  assert.ok(text("This file does not have a text preview."));
  result = { ...result, data: null, error: "File no longer exists." };
  assert.equal(find(render(), (node) => node.type === "ErrorNotice").props.message, result.error);
});

test("mobile picked files preview locally before sending", async () => {
  const react = hookHost({ effects: true });
  let closed = false;
  const bytes = new TextEncoder().encode("export const draft = true;");
  const { default: FilePreview } = load("app/file-preview.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-file-system": {
      FileMode: { ReadOnly: "readOnly" },
      File: class {
        constructor(uri) {
          assert.equal(uri, "file:///phone/ui.tsx");
          this.size = bytes.length;
        }
        open(mode) {
          assert.equal(mode, "readOnly");
          return {
            readBytes(length) {
              assert.equal(length, bytes.length);
              return bytes;
            },
            close() {
              closed = true;
            },
          };
        }
      },
    },
    "react-native": { Platform: { OS: "ios" }, Text: "Text", View: "View" },
    "expo-router": { Stack: { Screen: "Screen" }, useLocalSearchParams: () => ({ uri: "file:///phone/ui.tsx", name: "ui.tsx" }) },
    "../session": { useSession: () => ({ client: null }) },
    "../use-rpc": {
      useRpc: (client) => {
        assert.equal(client, null, "local files do not read from the computer");
        return {};
      },
    },
    "../file-code": { FileCode: "FileCode" },
    "../ui": { colors: {}, styles: {}, ErrorNotice: "ErrorNotice", PageScroll: "PageScroll" },
  });
  react.begin();
  FilePreview();
  await settle();
  react.begin();
  assert.ok(find(FilePreview(), (node) => node.type === "FileCode" && node.props.text === "export const draft = true;" && node.props.name === "ui.tsx"));
  assert.equal(closed, true);
});

test("mobile TSX preview colors native text in both themes and preserves selection", () => {
  const react = hookHost();
  let scheme = "light";
  const { FileCode } = load("file-code.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Text: "Text", useColorScheme: () => scheme },
    "@milagre/shared/file-syntax": require("@milagre/shared/file-syntax"),
    "./theme": { fonts: { mono: "Menlo" } },
    "./ui": { colors: {}, styles: {} },
  });
  const text = 'export const Card = () => (\r\n  <section title="hello">Welcome</section>\r\n);\r\n';
  const render = () => {
    react.begin();
    return FileCode({ text, name: "Card.tsx" });
  };
  const light = render();
  const selectable = find(light, (node) => node.type === "Text" && node.props.selectable);
  assert.equal(selectable.props.children.map((node) => node.props.children).join(""), text);
  const keyword = (tree) => find(tree, (node) => node.type === "Text" && node.props.children === "export").props.style.color;
  const tag = (tree) => find(tree, (node) => node.type === "Text" && node.props.children === "section").props.style.color;
  assert.notEqual(keyword(light), tag(light));
  scheme = "dark";
  const dark = render();
  assert.notEqual(keyword(dark), keyword(light));
  assert.notEqual(keyword(dark), tag(dark));
});

for (const provider of ["claude", "codex"])
  test(`mobile Project Accounts assigns within a scope and restores inheritance (${provider})`, async () => {
    const react = hookHost({ effects: true });
    const calls = [];
    const login = deferred();
    const snapshot = {
      scopeKey: "/p",
      providers: [
        {
          provider,
          accountId: null,
          effectiveId: "default",
          defaultId: "default",
          accounts: [
            { id: "default", provider, label: "CLI", email: "default@example.test", state: "ready" },
            { id: "work", provider, label: "Work", email: "work@example.test", plan: "business", state: "ready" },
            { id: "out", provider, label: "Expired", state: "signed-out" },
            { id: "gone", provider, label: "Removed account", state: "error", missing: true, message: "Choose a saved account." },
          ],
        },
      ],
    };
    const session = {
      snapshot: { project: { path: "/p" } },
      refreshProviders: async () => calls.push(["refreshProviders"]),
      client: {
        call: async (method, args = []) => {
          calls.push([method, ...args]);
          if (method === "accounts:scopes")
            return [
              { key: "/p", name: "Project", kind: "project", projects: [{ id: "p", path: "/p", name: "Project" }] },
              { key: "milagre-link:two", name: "Linked work", kind: "link", projects: [{ id: "p", path: "/p", name: "Project" }] },
            ];
          if (method === "accounts:login") return login.promise;
          if (method === "accounts:scope") return { ...structuredClone(snapshot), scopeKey: args[0] };
          if (method === "accounts:assign") {
            snapshot.providers[0].accountId = args[2];
            snapshot.providers[0].effectiveId = args[2] || "default";
          }
          return structuredClone(snapshot);
        },
      },
    };
    const { ProjectAccountsSection } = load("project-accounts-section.tsx", {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Text: "Text", View: "View", Pressable: "Pressable" },
      "@hugeicons/core-free-icons": {},
      "@milagre/shared/providers": require("@milagre/shared/providers"),
      "./session": { useSession: () => session },
      "./icons": { Icon: "Icon", ProviderLogo: "ProviderLogo" },
      "./project-icon": { ProjectIcon: "ProjectIcon", ProjectIcons: "ProjectIcons" },
      "./ui": { ListRow: "ListRow", PageScroll: "PageScroll", PullDown: "PullDown", colors: {}, styles: {} },
      "expo-router": { router: { push() {} } },
    });
    const render = () => {
      react.begin();
      return ProjectAccountsSection().type();
    };
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    try {
      render();
      await settle();
      render();
      await settle();
      const menu = () => find(render(), (n) => n.type === "PullDown" && n.props.label === `${provider === "claude" ? "Claude" : "Codex"} account`);
      assert.ok(menu(), "Provider selector loads for the current Project");
      const items = menu().props.sections.flatMap((s) => s.items);
      assert.equal(items.find((i) => i.id === "out").disabled, true);
      assert.equal(items.find((i) => i.id === "gone").disabled, true);
      assert.equal(
        find(render(), (n) => n.props.title === "Re-authenticate: Removed account"),
        undefined,
      );
      assert.equal(
        find(render(), (n) => n.props.title === "Re-authenticate: default@example.test"),
        undefined,
      );
      assert.match(items.find((i) => i.id === "__default__").title, /default@example.test/);
      menu().props.onSelect("work");
      await settle();
      assert.ok(calls.some((c) => c[0] === "accounts:assign" && c[1] === "/p" && c[2] === provider && c[3] === "work"));
      menu().props.onSelect("__default__");
      await settle();
      assert.ok(calls.some((c) => c[0] === "accounts:assign" && c[3] === null));
      assert.ok(calls.some((c) => c[0] === "refreshProviders"));
      assert.equal(find(render(), (n) => n.type === "ListRow" && n.props.title === "Project").props.leading.props.path, "/p");
      find(render(), (n) => n.props.title === "Re-authenticate: Expired").props.onPress();
      find(render(), (n) => n.props.title === "Project").props.onPress();
      find(render(), (n) => n.props.title === "Linked work").props.onPress();
      render();
      await settle();
      const scopeReads = calls.filter((c) => c[0] === "accounts:scope").length;
      login.resolve({});
      await settle();
      assert.equal(
        calls.filter((c) => c[0] === "accounts:scope").length,
        scopeReads,
        "Finishing login from an old scope must not invalidate current scope reads",
      );
      assert.ok(menu());
      assert.equal(find(render(), (n) => n.props.title === "Linked work").props.leading.type, "ProjectIcons");
    } finally {
      react.unmount();
    }
  });

test("mobile provider discovery uses the selected scope and ignores late responses after switching", async () => {
  const stale = deferred();
  const requests = [],
    sockets = [];
  const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  const render = sessionHost(
    {
      call: async (method, args) => {
        if (method === "project:recent") return [];
        if (method === "agent:models" || method === "agent:cli-status") {
          requests.push([method, ...(args || [])]);
          if (args?.[0] === "A") return stale.promise;
          return { source: args?.[0] || "default" };
        }
        return {};
      },
      snapshot: async (path) => snapshot(path),
      live: (_path, options) => {
        sockets.push(options);
        return { close() {} };
      },
    },
    { effects: true, AppState },
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await render().connect({ address: "mac", token: "token" });
    await render().open("A");
    render();
    await render().open("B");
    render();
    await settle();
    assert.equal(render().models.source, "B");
    stale.resolve({ source: "A" });
    await settle();
    assert.equal(render().models.source, "B");
    assert.equal(render().cliStatus.source, "B");
    const before = render().providerRevision;
    sockets.at(-1).onSignal("accounts");
    await settle();
    assert.ok(render().providerRevision > before);
    assert.ok(requests.some((request) => request.join(":") === "agent:models:B"));
    assert.ok(requests.some((request) => request.join(":") === "agent:cli-status:B"));
  } finally {
    render.unmount();
  }
});

test("mobile Project Accounts opens from Settings as a native stack screen", () => {
  const opened = [];
  const { SettingsView } = load("app/settings.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { View: "View" },
    "expo-router": { Stack: { Screen: "Screen" }, router: { push() {} } },
    "@hugeicons/core-free-icons": {},
    "../session": { useSession: () => ({ recent: [], client: null }) },
    "../project-icon": { ProjectIcon: "ProjectIcon" },
    "../push": { usePush: () => ({}) },
    "../update-sheet": { useAppUpdates: () => ({ state: { status: "disabled" } }) },
    "../icons": { Icon: "Icon" },
    "../ui": { ListRow: "ListRow", PageScroll: "PageScroll", Toggle: "Toggle", styles: {} },
    "../attention": { useAttentionButton: () => [true, () => {}] },
  });
  find(SettingsView({ onOpen: (page) => opened.push(page) }), (n) => n.props.title === "Project Accounts").props.onPress();
  assert.deepEqual(opened, ["project-accounts"]);
  const { default: Screen } = load("app/project-accounts.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-router": { Stack: { Screen: "Screen" } },
    "../ui": { PageScroll: "PageScroll" },
    "../project-accounts-section": { ProjectAccountsSection: "ProjectAccountsSection" },
  });
  assert.equal(find(Screen(), (n) => n.type === "Screen").props.options.title, "Project Accounts");
  assert.ok(find(Screen(), (n) => n.type === "ProjectAccountsSection"));
});

test("new mobile Chat has no simulator pill; an existing Chat carries its identity", () => {
  const fresh = chatHost();
  assert.equal(
    find(fresh.render(), (n) => n.type === "SimulatorChip"),
    undefined,
  );
  const existing = ongoingChatHost();
  assert.equal(find(existing.render(), (n) => n.type === "SimulatorChip").props.chatId, "/p#7");
  assert.equal(
    find(fresh.render(), (n) => n.type === "PortsChip"),
    undefined,
  );
  assert.equal(find(existing.render(), (n) => n.type === "PortsChip").props.chatId, "/p#7");
});

test("mobile simulator pill stays hidden until this Chat has attachments, including stopped devices", async (t) => {
  const device = { id: "a", name: "My iPhone", platform: "ios", version: "27" };
  for (const attached of [[], [device]]) {
    const gate = deferred();
    const h = simulatorHost({ url: "mac", call: () => gate.promise });
    t.after(() => h.cleanup());
    const render = () => h.render("SimulatorChip", { chatId: "/p#7" });
    assert.equal(render(), null, "loading must not flash an empty pill");
    gate.resolve({ chatId: "/p#7", supported: true, devices: [], attached, available: [device] });
    await settle();
    if (attached.length) assert.equal(render().props.accessibilityLabel, "Simulators, 1 attached to this Chat");
    else assert.equal(render(), null, "other running devices must not show the pill");
    h.cleanup();
  }
});

test("mobile simulator pill disappears after the last attachment is removed", async (t) => {
  const device = { id: "a", name: "My iPhone", platform: "ios", version: "27" };
  let attached = [device];
  const h = simulatorHost({ url: "mac", call: async () => ({ chatId: "/p#7", supported: true, devices: attached, attached }) });
  t.after(() => h.cleanup());
  const render = () => h.render("SimulatorChip", { chatId: "/p#7" });
  render();
  await settle();
  assert.ok(render());
  attached = [];
  h.foreground();
  await settle();
  assert.equal(render(), null);
});

test("mobile picker exposes other devices only in Attach and detach updates this Chat", async () => {
  const a = { id: "a", name: "My iPhone", platform: "ios", version: "27" };
  const b = { id: "b", name: "Other device", platform: "android", version: "16" };
  let attached = [a];
  const calls = [];
  const h = simulatorHost({
    url: "mac",
    call: async (method, args) => {
      calls.push([method, args]);
      if (method === "simulator:attach") attached.push(b);
      if (method === "simulator:detach") attached = attached.filter((d) => d.id !== args[0].deviceId);
      return { chatId: "/p#7", supported: true, devices: attached, attached, available: [a, b].filter((d) => !attached.some((x) => x.id === d.id)) };
    },
  });
  const render = () => h.render("SimulatorSheet", { hostId: "mac", chatId: "/p#7" });
  render();
  await settle();
  assert.equal(
    find(render(), (n) => n.props.label === "Back to devices"),
    undefined,
    "the viewer has no back button",
  );
  find(render(), (n) => n.props.accessibilityLabel === "My iPhone, choose simulator").props.onPress();
  assert.equal(
    find(render(), (n) => n.props.accessibilityLabel === "Attach Other device"),
    undefined,
  );
  find(render(), (n) => n.props.title === "Attach simulator").props.onPress();
  find(render(), (n) => n.props.accessibilityLabel === "Attach Other device").props.onPress();
  await settle();
  assert.ok(find(render(), (n) => n.props.deviceId === "b"));
  find(render(), (n) => n.props.accessibilityLabel === "Other device, choose simulator").props.onPress();
  find(render(), (n) => n.props.label === "Detach Other device from Chat").props.onPress();
  await settle();
  assert.equal(
    find(render(), (n) => n.props.label === "Detach Other device from Chat"),
    undefined,
  );
  for (const [, args] of calls) assert.equal(args[0].chatId, "/p#7");
  h.cleanup();
});

function archiveIndicator(tree) {
  const component = find(tree, (node) => node.type === archiveProgress.ArchiveProgress);
  return component && find(component.type(component.props), (node) => node.props.accessibilityRole === "progressbar");
}

test("sidebar archive shows progress during a delayed request and clears it on failure", async () => {
  const project = archiveProject();
  const patch = deferred();
  const nav = navigationHost(deferred().promise, {
    alert: pressDanger([]),
    session: {
      client: { ...project.client, url: "mac", call: (method, args) => (method === "chat:patch" ? patch.promise : project.call(method, args)) },
      recent: [{ path: "/p" }],
      snapshot: project.snapshot,
      expectActivity() {},
      refresh: async () => {},
    },
  });
  nav.more(nav.row("chat")).props.onSelect("archive");
  await settleAll();
  assert.ok(archiveIndicator(nav.render()), "archive feedback must survive closing the action sheet");
  nav.more(nav.row("chat")).props.onSelect("archive");
  assert.equal(project.calls.filter(([method]) => method === "worktree:roots").length, 1);
  patch.reject(new Error("disk full"));
  await settleAll();
  assert.equal(archiveIndicator(nav.render()), undefined);
  assert.equal(find(nav.render(), (node) => node.type === "ErrorNotice").props.message, "disk full");
});

test("Chat header shows archive progress until the delayed request completes", async () => {
  const project = archiveProject();
  const patch = deferred();
  const screen = chatHost({ alert: pressDanger([]), call: (method, args) => (method === "chat:patch" ? patch.promise : project.call(method, args)) });
  screen.session.snapshot = project.snapshot;
  screen.session.client.snapshot = async () => project.snapshot;
  screen.params.id = "5";
  delete screen.params.worktreeId;
  const menuAction = () => find(screen.render(), (node) => node.type === "ToolbarMenuAction" && node.props.children === "Archive");
  menuAction().props.onPress();
  await settleAll();
  const header = () => find(screen.render(), (node) => node.type === "Screen").props.options.headerTitle();
  assert.ok(archiveIndicator(header()));
  assert.equal(menuAction().props.disabled, true);
  patch.resolve();
  await settleAll();
  assert.equal(archiveIndicator(header()), undefined);
  assert.equal(screen.router.replaced, "/projects");
});

test("mobile Ports pill requests only its Chat and hides empty or mismatched responses", async (t) => {
  for (const reply of [
    { chatId: "/p#7", ports: [] },
    { chatId: "/p#8", ports: [{ port: 3000, pid: 22 }] },
    { chatId: "/p#7", ports: [{ port: 3000, pid: 22 }] },
  ]) {
    const calls = [];
    const h = simulatorHost(
      {
        url: "mac",
        call: async (...args) => {
          calls.push(args);
          return reply;
        },
      },
      "ports.tsx",
    );
    t.after(() => h.cleanup());
    const render = () => h.render("PortsChip", { chatId: "/p#7" });
    assert.equal(render(), null);
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["chat:ports", ["/p#7"]]]);
    if (reply.chatId === "/p#7" && reply.ports.length) assert.equal(render().props.accessibilityLabel, "Ports, 1 listening");
    else assert.equal(render(), null);
  }
});

test("mobile Ports sheet stops only this Chat's process and refuses another host", async (t) => {
  const calls = [];
  let ports = [{ port: 3000, pid: 22, command: "node", address: "127.0.0.1" }];
  const client = {
    url: "mac",
    call: async (method, args) => {
      calls.push([method, args]);
      if (method === "agent:stop-port") {
        ports = [];
        return true;
      }
      return { chatId: "/p#7", ports };
    },
  };
  const h = simulatorHost(client, "ports.tsx");
  t.after(() => h.cleanup());
  const render = () => h.render("PortsSheet", { hostId: "mac", chatId: "/p#7" });
  render();
  await settle();
  await find(render(), (n) => n.props.accessibilityLabel === "Stop port 3000").props.onPress();
  await settle();
  assert.ok(calls.some(([method, args]) => method === "agent:stop-port" && args[0] === "/p#7" && args[1] === 22));
  assert.equal(
    find(render(), (n) => n.props.accessibilityLabel === "Stop port 3000"),
    undefined,
  );
  const other = simulatorHost(client, "ports.tsx");
  t.after(() => other.cleanup());
  calls.length = 0;
  other.render("PortsSheet", { hostId: "other", chatId: "/p#7" });
  await settle();
  assert.deepEqual(calls, []);
});

test("a reply shows the thinking it wrote nothing after, once it waits on a question or ends, not while working", () => {
  const react = { memo: (fn) => fn, useCallback: (fn) => fn, useEffect() {}, useRef: () => ({}), useState: (value) => [value, () => {}] };
  const { ChatReply } = load("chat-reply.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Image: "Image", Pressable: "Pressable", Text: "Text", View: "View", useColorScheme: () => "dark" },
    "react-native-svg": { default: "Svg", Path: "Path" },
    "expo-router": { router: {} },
    "@hugeicons/core-free-icons": new Proxy({}, { get: (_, key) => key }),
    "@milagre/shared/reply-parts": require("@milagre/shared/reply-parts"),
    "./file-chip": { FileChip: "FileChip" },
    "./markdown": { Markdown: "Markdown" },
    "./icons": { Icon: "Icon" },
    "./activity-item": { ActivityTitle: "ActivityTitle" },
    "./tool-row": { ToolRow: "ToolRow" },
    "./theme": { hex: () => "#000" },
    "./viewer-store": { showImages() {} },
    "./ui": { colors: {}, styles: { card: {}, row: {}, muted: {} } },
  });
  const conclusion = "T3 Code tries every route in parallel.";
  const steps = [
    { id: "t1", kind: "thinking", title: "Thought", status: "done", detail: "Looking.", offset: 9 },
    { id: "a", kind: "other", title: "Ran an agent", status: "done", offset: 9 },
    { id: "t2", kind: "thinking", title: "Thought", status: "done", detail: conclusion, offset: 9 },
  ];
  const run = (questions) => ({ text: "Checking.", model: "m", startedAt: 0, steps, approvals: [], questions, answered: {} });
  const markdown = (tree) => {
    const texts = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.type === "Markdown") texts.push(node.props.text);
      walk(node.props?.children);
    };
    walk(tree);
    return texts;
  };
  const props = { media: () => null, onActivity() {} };
  assert.deepEqual(markdown(ChatReply({ ...props, run: run([{ requestId: "q" }]) })), ["Checking.", conclusion]);
  assert.deepEqual(markdown(ChatReply({ ...props, run: run([]) })), ["Checking."]);
  assert.deepEqual(markdown(ChatReply({ ...props, message: { id: 1, session_id: 1, role: "assistant", body: "Checking.", steps } })), [
    "Checking.",
    conclusion,
  ]);
  assert.deepEqual(
    markdown(ChatReply({ ...props, message: { id: 1, session_id: 1, role: "assistant", body: "Checking. Done.", steps: [{ ...steps[2], offset: 0 }] } })),
    ["Checking. Done."],
  );
});

test("mobile usage identifies the account by email, falls back to its label, and accepts older hosts", () => {
  const { ProviderRows } = load(
    "usage-section.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {},
      "react-native": { Text: "Text", View: "View" },
      "@hugeicons/core-free-icons": {},
      "@milagre/shared/providers": { providerName: () => "Codex" },
      "@milagre/shared/usage": { formatUpdatedAgo: () => "Updated just now" },
      "./icons": {},
      "./ui": { colors: {}, styles: {} },
      "./session": {},
      "./use-usage": {},
    },
    "\nexport { ProviderRows };\n",
  );
  const provider = { provider: "codex", status: "ok", windows: [], updatedAt: new Date().toISOString() };
  for (const account of [
    { id: "work", label: "Work", email: "work@example.test" },
    { id: "work", label: "Work" },
  ]) {
    const tree = ProviderRows({ provider: { ...provider, account }, now: Date.now() });
    const label = find(tree, (node) => node.type === "Text" && node.props.children === (account.email || account.label));
    assert.ok(label, "The account identity is visible");
    assert.equal(label.props.selectable, true);
    assert.equal(
      find(tree, (node) => node.type === "Text" && node.props.children === "Codex"),
      undefined,
    );
  }
  assert.doesNotThrow(() => ProviderRows({ provider, now: Date.now() }));
});
