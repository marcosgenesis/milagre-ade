const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Execute the actual hook/screen handlers without loading native modules in Node.
// Effects are driven explicitly so request ordering is deterministic.
function hookHost({ effects = false } = {}) {
  const slots = [];
  const queuedEffects = [];
  let cursor = 0;
  return {
    begin() { cursor = 0; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
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
    }, createContext() { return {}; }, useContext() {},
    effect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i])) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        queuedEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
    flush() { for (const effect of queuedEffects.splice(0)) effect(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function load(file, modules, extra = '') {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps/mobile/src', file), 'utf8') + extra;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    assert.ok(id in modules, `Unexpected import: ${id}`);
    return modules[id];
  }, process: { env: {} }, URL, setTimeout, clearTimeout, setInterval, clearInterval });
  return exports;
}
const jsx = (type, props) => ({ type, props });

function markdownHost({ media, basePath } = {}) {
  const react = { ...hookHost({ effects: true }), memo: fn => fn };
  const viewer = require('../apps/mobile/src/viewer-store.ts');
  const routes = [], links = [];
  const { Markdown } = load('markdown.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', Alert: {}, Linking: { openURL: async url => { links.push(url); } } },
    'expo-router': { router: { push: route => routes.push(route) } }, './viewer-store': viewer,
    './chat-presentation': require('../apps/mobile/src/chat-presentation.ts'),
    './markdown-image': require('../apps/mobile/src/markdown-image.ts'),
    './ui': { PageScroll: 'PageScroll', colors: {}, styles: { muted: {}, code: {} } },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return { render(text) { react.begin(); return expand(Markdown({ text, media, basePath })); }, routes, links, viewer };
}

test('Markdown screenshot links render image previews outside Text and open the image viewer', () => {
  const screen = markdownHost();
  const url = 'https://raw.githubusercontent.com/marcosgenesis/milagre-ade/22cc3932b99921b51318d869f617db4bfef45523/mobile-push/computers.jpg';
  const rendered = screen.render(`Here is the **Computers screen**:\n\n![Computers with Settings and bottom +](${url})`);
  const image = find(rendered, node => node.type === 'Image');
  assert.ok(image, 'The screenshot must render as an image, not an alt-text placeholder');
  assert.equal(image.props.source.uri, url);
  assert.equal(find(rendered, node => node.type === 'Text' && [node.props.children].flat(Infinity).some(child => find(child, nested => nested.type === 'Image'))), undefined);
  const preview = find(rendered, node => node.props?.accessibilityRole === 'imagebutton');
  preview.props.onPress();
  assert.equal(screen.routes.at(-1), '/viewer');
  assert.equal(screen.viewer.viewerImages().images[0].source.uri, url);
});

test('local Markdown images use the computer connection and keep authentication in the viewer', () => {
  const paths = [];
  const source = { uri: 'https://mac/media?path=shot', headers: { Authorization: 'Bearer paired-token' } };
  const screen = markdownHost({ basePath: '/worktrees/feature', media: path => { paths.push(path); return source; } });
  const rendered = screen.render('![Screenshot](./screens/left%20bar.png)');
  const image = find(rendered, node => node.type === 'Image');
  assert.ok(image, 'a local path must use the daemon, not disappear into alt text');
  assert.deepEqual(paths, ['/worktrees/feature/screens/left bar.png']);
  assert.equal(image.props.source, source);
  find(rendered, node => node.props?.accessibilityRole === 'imagebutton').props.onPress();
  assert.equal(screen.viewer.viewerImages().images[0].source, source);
});

test('relay Markdown images wait for the cached file and render it when ready', async () => {
  const file = deferred();
  const screen = markdownHost({ media: () => file.promise });
  const text = '![Screenshot](/tmp/shot.png)';
  assert.equal(find(screen.render(text), node => node.type === 'Image'), undefined);
  file.resolve({ uri: 'file:///phone/cache/shot.png' });
  await settle();
  assert.equal(find(screen.render(text), node => node.type === 'Image')?.props.source.uri, 'file:///phone/cache/shot.png');
});

test('images embedded in emphasis, links and tables keep their surrounding text', () => {
  const screen = markdownHost();
  const rendered = screen.render('Before **bold ![Preview](https://example.org/screen.png) after** end.\n\n| Screenshot |\n| --- |\n| [![Table preview](https://example.org/table.png)](https://example.org) |');
  assert.ok(find(rendered, node => node.type === 'Image' && node.props.source.uri === 'https://example.org/screen.png'));
  assert.ok(find(rendered, node => node.type === 'Image' && node.props.source.uri === 'https://example.org/table.png'));
  assert.ok(find(rendered, node => node.type === 'Text' && Array.isArray(node.props.style) && node.props.style.some(style => style.fontWeight === '600') && [node.props.children].flat(Infinity).some(child => find(child, nested => nested.type === 'Text' && nested.props.children === ' after'))));
});

test('a broken Markdown image leaves a browser link, and unsafe sources never load', async () => {
  const screen = markdownHost();
  const text = '![Missing screenshot](https://example.org/missing.png)';
  find(screen.render(text), node => node.type === 'Image').props.onError();
  const fallback = find(screen.render(text), node => node.props?.accessibilityRole === 'link');
  assert.ok(fallback);
  await fallback.props.onPress();
  assert.equal(screen.links.at(-1), 'https://example.org/missing.png');
  for (const source of ['file:///etc/passwd', 'mailto:hello@example.org', 'milagre://pair', 'https://secret@example.org/image.png']) {
    assert.equal(find(markdownHost().render(`![blocked](${source})`), node => node.type === 'Image'), undefined);
  }
});
const snapshot = projectPath => ({ project: { path: projectPath, state: { sessions: {} } }, runs: { runs: {} } });

const relayRuntime = { name: 'relay runtime' };
function sessionHost(client, { effects = false, AppState = {}, created = [], saved = [] } = {}) {
  const react = hookHost({ effects });
  const { useSessionState } = load('session.tsx', {
    react, '@milagre/shared/reconcile': require('@milagre/shared/reconcile'), 'react/jsx-runtime': { jsx }, 'react-native': { AppState }, './client': { createClient: (...args) => { created.push(args); return client; } }, './relay-native': { relayRuntime }, './live': require('../apps/mobile/src/live.ts'),
    './hosts-native': { savedHosts: { save: async host => { saved.push(host); }, list: async () => [] }, savedNavigation: { read: async () => null, save: async () => {} }, readPermission: async () => null, savePermission: async () => {} },
    './turn-options': require('../apps/mobile/src/turn-options.ts'), '@milagre/shared/model': {},
  }, '\nexport { useSessionState };');
  return Object.assign(() => { react.begin(); return useSessionState(); }, { unmount: react.unmount });
}

test('pairing through the relay builds the client from the pairing and saves the relay link', async () => {
  const created = [], saved = [];
  const relay = { url: 'wss://relay.milagre.cloud', hostId: 'H'.repeat(22), key: 'K'.repeat(43) };
  const render = sessionHost({ url: `relay://${relay.hostId}`, call: async method => method === 'project:recent' ? [] : {} }, { created, saved });
  const pairing = { address: `relay://${relay.hostId}`, token: 'a'.repeat(64), name: '', relay };
  assert.equal(await render().connect(pairing), true);
  assert.equal(created[0][0], pairing);
  assert.equal(created[0][3], relayRuntime);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ name: 'Mac', address: `relay://${relay.hostId}`, token: 'a'.repeat(64), relay }]);
  assert.equal(render().hostName, 'Mac');
});

test('a poll from the previous Project cannot restore it after another Project opens', async () => {
  const openingB = deferred(), pollingA = deferred();
  let delayA = false;
  const render = sessionHost({
    call: async (method, args) => method === 'project:recent' ? [] : method === 'project:open' ? (args[0] === 'B' ? openingB.promise : { path: 'A' }) : {},
    snapshot: async projectPath => projectPath === 'A' && delayA ? pollingA.promise : snapshot(projectPath),
  });
  await render().connect({ address: 'address', token: 'token' });
  await render().open('A');
  const oldSession = render();
  delayA = true;
  const alreadyPolling = oldSession.refresh();
  const opening = oldSession.open('B');
  const pollingDuringOpen = oldSession.refresh();
  openingB.resolve({ path: 'B' });
  await opening;
  assert.equal(render().snapshot.project.path, 'B');
  pollingA.resolve(snapshot('A'));
  await Promise.all([alreadyPolling, pollingDuringOpen]);
  assert.equal(render().snapshot.project.path, 'B');
  await oldSession.refresh();
  assert.equal(render().snapshot.project.path, 'B');
});

test('the session fetches on live signals and polls only while the live socket is down', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  const fetched = { snapshot: 0, runs: 0 };
  const listeners = [];
  const AppState = { currentState: 'active', addEventListener: (_event, listener) => { listeners.push(listener); return { remove() {} }; } };
  const setApp = state => { AppState.currentState = state; listeners.forEach(listener => listener(state)); };
  const render = sessionHost({
    call: async (method, args) => method === 'project:recent' ? [] : method === 'project:open' ? { path: args[0] } : {},
    snapshot: async projectPath => { fetched.snapshot++; return { ...snapshot(projectPath), runs: { runs: {}, seq: 1 } }; },
    runs: async () => { fetched.runs++; return { runs: { 'A#1': { text: 'streaming' } }, seq: 2 }; },
    live: (projectPath, options) => { const socket = { projectPath, options, closed: false, close() { socket.closed = true; } }; sockets.push(socket); return socket; },
  }, { effects: true, AppState });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const snapshots = async (count, message) => { await settle(); assert.equal(fetched.snapshot, count, message); };
  await render().connect({ address: 'address', token: 'token' });
  await render().open('A');
  render();
  assert.deepEqual(sockets.map(socket => socket.projectPath), ['A']);
  await snapshots(2, 'opening fetches, then the sync fetches once');
  t.mock.timers.tick(4000);
  await snapshots(3, 'it polls while the socket is not open (an older bridge)');
  sockets[0].options.onStatus(true);
  await snapshots(4, 'it catches up once the socket opens');
  t.mock.timers.tick(30000);
  await snapshots(4, 'no polling while live');
  sockets[0].options.onSignal('runs');
  await settle();
  assert.equal(fetched.runs, 1);
  assert.equal(render().snapshot.runs.runs['A#1'].text, 'streaming');
  assert.equal(render().snapshot.project.path, 'A');
  sockets[0].options.onSignal('project');
  await snapshots(5);
  sockets[0].options.onStatus(false);
  await snapshots(6, 'losing the socket fetches at once');
  t.mock.timers.tick(4000);
  await snapshots(7, 'and polls again');
  setApp('background');
  assert.equal(sockets[0].closed, true, 'the socket closes in the background');
  t.mock.timers.tick(30000);
  await snapshots(7, 'and nothing polls');
  setApp('active');
  assert.equal(sockets.length, 2, 'it opens again in the foreground');
  await snapshots(8);
  render.unmount();
  assert.equal(sockets[1].closed, true);
});

test('disconnect cancels a connection that is still loading recent Projects', async () => {
  const recent = deferred();
  const render = sessionHost({ call: async method => method === 'project:recent' ? recent.promise : {} });
  const connecting = render().connect({ address: 'address', token: 'token' });
  await Promise.resolve();
  render().disconnect();
  recent.resolve([]);
  await connecting;
  assert.equal(render().client, null);
});

function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function chatHost({ pickAttachments = async () => [], call, effects = false, alert = () => {} } = {}) {
  const sending = deferred();
  const calls = [];
  const params = { worktreeId: '1' };
  const session = {
    client: { call: (method, args) => { calls.push({ method, args }); return call ? call(method, args) : method === 'project:branches' ? Promise.resolve(['main']) : sending.promise; } },
    snapshot: { project: { path: '/p', name: 'P', state: { sessions: {}, messages: [], worktrees: {} } }, runs: { runs: {} } },
    drafts: { '/p#new:1': 'first message' },
    attachments: {}, setAttachments(fn) { this.attachments = fn(this.attachments); },
    preferences: {}, defaults: require('../apps/mobile/src/turn-options.ts').defaultPreferences, setDefaultPermission() {}, models: null, cliStatus: null,
    setPreferences(fn) { this.preferences = fn(this.preferences); },
    setDrafts(fn) { this.drafts = fn(this.drafts); },
    refresh: async () => { session.snapshot.project.state.sessions[42] = { id: 42, provider: 'codex' }; }, expectActivity() {}, isSelected: () => true,
  };
  const react = hookHost({ effects });
  const ui = { ...Object.fromEntries(['Button', 'IconButton', 'ErrorNotice', 'Field', 'PageScroll', 'PillButton', 'PullDown', 'HeaderButton'].map(name => [name, name])), styles: { code: {} }, colors: {} };
  const native = { ...Object.fromEntries(['KeyboardAvoidingView', 'Text', 'View', 'Image'].map(name => [name, name])), Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Alert: { alert }, Linking: {}, StyleSheet: { absoluteFill: {} } };
  const icons = new Proxy({}, { get: (_, name) => String(name) });
  const router = { setParams: values => Object.assign(params, values), push() {}, replace(route) { router.replaced = route; }, back() { router.backs = (router.backs ?? 0) + 1; } };
  const { default: ChatScreen } = load('app/chat.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen', Toolbar: Object.assign(() => null, { Menu: 'ToolbarMenu', MenuAction: 'ToolbarMenuAction', Button: 'ToolbarButton' }) }, router, useLocalSearchParams: () => params, useFocusEffect: fn => react.useEffect(fn, [fn]) },
    '@hugeicons/core-free-icons': icons, '@milagre/shared/pr-blockers': require('@milagre/shared/pr-blockers'), '../indicators': require('../apps/mobile/src/indicators.ts'), '../icons': { Icon: 'Icon' }, '../bottom-fade': { BottomFade: 'BottomFade', EdgeFade: 'EdgeFade' }, '../slide-over': { SlideOver: ({ children }) => children }, './changes': { ChangesView: 'ChangesView' }, '../dot-background': { useDotBackground: () => ({}) }, 'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardStickyView: 'KeyboardStickyView' }, '../running-logo': { ThinkingIndicator: 'ThinkingIndicator' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@milagre/shared/model': require('@milagre/shared/model'),
    '@milagre/shared/agent-runs': { lastUserModel: () => '' }, '@milagre/shared/chats': { isListedChat: (_chat, count) => count > 0 }, '../session': { useSession: () => session, useComposer: () => session }, '../attachment-picker': { pickAttachments }, '../attachments': require('../apps/mobile/src/attachments.ts'), '../status-indicators': { PullRequestAction: 'PullRequestAction', SubagentChip: 'SubagentChip', usePullRequest: () => null }, '../questions': { Approval: 'Approval', Questions: 'Questions' }, '../chat-reply': { ChatReply: 'ChatReply' }, '../ui': ui, '../agent-controls': { AgentControls: 'AgentControls', PermissionChip: 'PermissionChip' }, '../turn-options': require('../apps/mobile/src/turn-options.ts'), '../archive': require('../apps/mobile/src/archive.ts'),
  });
  const render = () => { react.begin(); return ChatScreen(); };
  const field = () => find(render(), node => node.type === 'Field' && node.props.label === 'Message').props;
  const send = () => find(render(), node => node.type === 'IconButton' && node.props.label === 'Send message').props.onPress();
  return { session, sending, params, field, send, render, router, calls };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('browsing another Project in the drawer leaves the current Chat selected', async () => {
  const render = sessionHost({ url: 'mac', call: async (method, args) => method === 'project:recent' ? [] : { path: args?.[0] }, snapshot: async path => snapshot(path) });
  await render().connect({ address: 'mac', token: 'token' });
  await render().open('/current');
  const before = render();
  const preview = await before.previewProject('/other');
  assert.equal(preview.project.path, '/other');
  assert.equal(render().snapshot.project.path, '/current');
  assert.equal(before.isSelected(), true);
});

test('closing the drawer during an open keeps the previous Chat usable', async () => {
  const loading = deferred();
  const render = sessionHost({ url: 'mac', call: async (method, args) => method === 'project:recent' ? [] : { path: args?.[0] }, snapshot: async path => path === '/other' ? loading.promise : snapshot(path) });
  await render().connect({ address: 'mac', token: 'token' });
  await render().open('/current');
  const before = render();
  const opening = before.open('/other', { background: true });
  render().cancelNavigation();
  loading.resolve(snapshot('/other'));
  assert.equal(await opening, undefined);
  assert.equal(render().snapshot.project.path, '/current');
  assert.equal(before.isSelected(), true);
});

test('a deleted drawer Chat does not switch the Project behind the drawer', async () => {
  const render = sessionHost({ url: 'mac', call: async (method, args) => method === 'project:recent' ? [] : { path: args?.[0] }, snapshot: async path => snapshot(path) });
  await render().connect({ address: 'mac', token: 'token' });
  await render().open('/current');
  await assert.rejects(render().open('/other', { background: true, chatId: 77 }), /no longer available/);
  assert.equal(render().snapshot.project.path, '/current');
});

test('cancelling a computer switch preserves the active Chat selection', async () => {
  const status = deferred();
  let delay = false;
  const render = sessionHost({ url: 'mac', call: async (method, args) => method === 'daemon:status' && delay ? status.promise : method === 'project:recent' ? [] : { path: args?.[0] }, snapshot: async path => snapshot(path) });
  await render().connect({ address: 'mac', token: 'token' });
  await render().open('/current');
  const before = render();
  delay = true;
  const connecting = before.connect({ address: 'studio', token: 'token' });
  render().cancelNavigation();
  status.resolve({});
  assert.equal(await connecting, false);
  assert.equal(before.isSelected(), true);
});

function resumeHost({ target = { hostId: 'mac', projectPath: '/last', chatId: 3 }, state = snapshot('/last'), failure } = {}) {
  const react = hookHost();
  react.useEffect = react.effect;
  const routes = [], opened = [];
  const session = { client: { url: 'mac' }, lastLocation: target, open: async path => { opened.push(path); if (failure) throw new Error(failure); return state; } };
  const { default: Screen } = load('app/projects.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' },
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen' }, router: { replace: route => routes.push(route) }, useLocalSearchParams: () => ({ resume: '1' }) },
    '../session': { useSession: () => session }, '../project-navigation': { ProjectNavigation: 'ProjectNavigation' }, '../ui': { ErrorNotice: 'ErrorNotice', styles: {} }, '../icons': { SpinnerRing: 'SpinnerRing' },
  });
  return { routes, opened, render() { react.begin(); const tree = Screen(); react.flush(); return tree; }, unmount: react.cleanup };
}

test('launch restoration opens the saved computer/Project/Chat target directly', async () => {
  const state = snapshot('/last'); state.project.state.sessions[3] = { id: 3 };
  const app = resumeHost({ state }); app.render(); await settle();
  assert.deepEqual(app.opened, ['/last']);
  assert.equal(app.routes.length, 1);
  assert.equal(app.routes[0].pathname, '/chat');
  assert.equal(app.routes[0].params.id, '3');
  assert.equal(app.routes[0].params.hostId, 'mac');
  assert.equal(app.routes[0].params.projectPath, '/last');
});

test('missing, archived and unreachable last Chats leave the project list usable', async () => {
  const archived = snapshot('/last'); archived.project.state.sessions[3] = { id: 3, archived: true };
  for (const input of [{}, { state: archived }, { failure: 'offline' }, { target: { hostId: 'other', projectPath: '/last', chatId: 3 } }]) {
    const app = resumeHost(input); app.render(); await settle();
    assert.equal(app.routes.length, 0);
    assert.ok(find(app.render(), node => node.type === 'ProjectNavigation'));
  }
});

function pullDownHost() {
  const sheets = [];
  const modifiers = new Proxy({}, { get: (_, name) => name === 'shapes' ? { rectangle: () => 'rectangle' } : value => ({ name, value }) });
  const { PullDown } = load('ui.tsx', {
    react: { forwardRef: fn => fn }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, ActionSheetIOS: { showActionSheetWithOptions: (options, select) => sheets.push({ options, select }) }, StyleSheet: { create: value => value }, Pressable: 'Pressable', View: 'View' },
    '@expo/ui': {}, '@expo/ui/swift-ui': Object.fromEntries(['Button', 'Host', 'Menu', 'Picker', 'Section', 'Text', 'Toggle', 'HStack', 'Image', 'Rectangle'].map(name => [name, `IOS${name}`])), '@expo/ui/swift-ui/modifiers': modifiers, '@expo/ui/community/menu': { MenuView: 'MenuView' },
    'expo-haptics': { selectionAsync: async () => {} }, '@hugeicons/core-free-icons': {}, './theme': { colors: { ink2: '#aaa', ink3: '#666' }, fonts: { mono: 'monospace' } }, './icons': { Icon: 'Icon' },
  });
  return { PullDown, sheets };
}

test('composer attachment choices stay in a native menu after the header action-sheet fix', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const kinds = [];
  const screen = chatHost({ pickAttachments: async kind => { kinds.push(kind); return []; } });
  const { PullDown, sheets } = pullDownHost();
  const trigger = find(screen.render(), node => node.type === 'PullDown' && node.props.label === 'Add photos or files');
  const rendered = PullDown(trigger.props);
  const menu = find(rendered, node => node.type === 'IOSMenu');
  assert.ok(menu, 'the attachment + must open a menu, not the header action sheet');
  assert.equal(find(menu.props.label, node => node.type === 'View'), undefined, 'the SwiftUI trigger cannot host React Native views');
  const files = find(menu, node => node.type === 'IOSButton' && node.props.label === 'Choose Files');
  files.props.onPress();
  t.mock.timers.tick(250);
  await settle();
  assert.deepEqual(kinds, ['files']);
  assert.equal(sheets.length, 0);
});

test('header switchers keep the shared native overlay without hosting React views', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { PullDown, sheets } = pullDownHost();
  const selected = [];
  const header = PullDown({ label: 'Switch Chat', sections: [{ items: [{ id: 'current', title: 'Current Chat', checked: true }, { id: 'other', title: 'Other Chat' }] }], children: jsx('View', {}), onSelect: id => selected.push(id) });
  const menu = find(header, node => node.type === 'IOSMenu');
  assert.equal(menu.props.label.type, 'IOSRectangle');
  assert.equal(find(menu, node => node.type === 'View'), undefined, 'React trigger stays outside SwiftUI');
  find(menu, node => node.type === 'IOSButton' && node.props.label === 'Other Chat').props.onPress();
  t.mock.timers.tick(250);
  assert.deepEqual(selected, ['other']);
  assert.equal(sheets.length, 0);
});

test('New Chat opens the composer directly when there are multiple Worktrees', () => {
  const react = hookHost();
  const pushed = [];
  const session = { client: {}, recent: [], snapshot: { project: { path: '/p', name: 'P', state: { sessions: {}, messages: [], worktrees: { 1: { id: 1, name: 'main' }, 2: { id: 2, name: 'feature' } } } }, runs: { runs: {} } } };
  const { default: ChatsScreen } = load('app/project.tsx', {
    'expo-clipboard': { setStringAsync: async () => {} },
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Alert: {}, FlatList: 'FlatList', Pressable: 'Pressable', RefreshControl: 'RefreshControl', Text: 'Text', View: 'View' },
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen', SearchBar: 'SearchBar', Toolbar: Object.assign(() => null, { Menu: 'ToolbarMenu', MenuAction: 'ToolbarMenuAction', Button: 'ToolbarButton', SearchBarSlot: 'SearchBarSlot', Spacer: 'Spacer' }) }, router: { push: route => pushed.push(route) } },
    '@hugeicons/core-free-icons': new Proxy({}, { get: (_, name) => String(name) }), '../session': { useSession: () => session }, '../indicators': require('../apps/mobile/src/indicators.ts'), '@milagre/shared/chats': require('@milagre/shared/chats'),
    '../status-indicators': { ChatMarkIcon: 'ChatMarkIcon', PullRequestLabel: 'PullRequestLabel', usePullRequest: () => null }, '../icons': { Icon: 'Icon', ProviderLogo: 'ProviderLogo', SpinnerRing: 'SpinnerRing' }, '../ui': { ErrorNotice: 'ErrorNotice', PullDown: 'PullDown', colors: {}, styles: {} }, '../archive': require('../apps/mobile/src/archive.ts'),
  });
  react.begin();
  const button = find(ChatsScreen(), node => node.props?.accessibilityLabel === 'New Chat');
  assert.equal(typeof button.props.onPress, 'function', 'one tap must navigate without choosing a Worktree first');
  button.props.onPress();
  assert.equal(JSON.stringify(pushed), JSON.stringify([{ pathname: '/chat', params: { worktreeId: '1', projectPath: '/p' } }]));
});

// A Project with one Chat (5) in a Milagre worktree that holds an uncommitted file, its turn running.
function archiveProject() {
  const calls = [];
  const dirty = { uncommitted: 1, unpushed: 0, branch: 'milagre/fix', head: 'h1', removable: false };
  const worktrees = { 1: { id: 1, name: 'main', path: '/p' }, 2: { id: 2, name: 'milagre/fix', path: '/wt/p/fix', base: 'main' } };
  const snapshot = { project: { path: '/p', name: 'P', state: { sessions: { 5: { id: 5, worktree_id: 2, title: 'Fix' } }, messages: [{ id: 1, session_id: 5, role: 'user', body: 'Fix it' }], worktrees } }, runs: { runs: { '/p#5': { questions: [], approvals: [], steps: [] } } } };
  const call = async (method, args = []) => {
    calls.push([method, ...args]);
    if (method === 'worktree:roots') return ['/wt'];
    if (method === 'worktree:status') return dirty;
    return null;
  };
  return { calls, snapshot, call, client: { call, snapshot: async () => snapshot } };
}
// Presses the first destructive button, after recording what the alert showed.
const pressDanger = alerts => (title, message, buttons) => { alerts.push({ title, message, buttons: buttons.map(button => [button.text, button.style]) }); buttons.find(button => button.style === 'destructive').onPress(); };
async function settleAll() { for (let i = 0; i < 10; i++) await settle(); }

test('a Chat row Archive asks with the worktree choice, then stops, hides and deletes the worktree', async () => {
  const react = hookHost();
  const alerts = [];
  const project = archiveProject();
  const session = { client: project.client, recent: [], snapshot: project.snapshot, expectActivity() {}, refresh: async () => { project.calls.push(['refresh']); } };
  const { default: ChatsScreen } = load('app/project.tsx', {
    'expo-clipboard': { setStringAsync: async () => {} },
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Alert: { alert: pressDanger(alerts) }, FlatList: 'FlatList', Pressable: 'Pressable', RefreshControl: 'RefreshControl', Text: 'Text', View: 'View' },
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen', SearchBar: 'SearchBar', Toolbar: Object.assign(() => null, { Menu: 'ToolbarMenu', MenuAction: 'ToolbarMenuAction', Button: 'ToolbarButton', SearchBarSlot: 'SearchBarSlot', Spacer: 'Spacer' }) }, router: { push() {} } },
    '@hugeicons/core-free-icons': new Proxy({}, { get: (_, name) => String(name) }), '../session': { useSession: () => session }, '../indicators': require('../apps/mobile/src/indicators.ts'), '@milagre/shared/chats': require('@milagre/shared/chats'),
    '../status-indicators': { ChatMarkIcon: 'ChatMarkIcon', PullRequestLabel: 'PullRequestLabel', usePullRequest: () => null }, '../icons': { Icon: 'Icon', ProviderLogo: 'ProviderLogo', SpinnerRing: 'SpinnerRing' }, '../ui': { ErrorNotice: 'ErrorNotice', PullDown: 'PullDown', colors: {}, styles: {} }, '../archive': require('../apps/mobile/src/archive.ts'),
  });
  react.begin();
  const list = find(ChatsScreen(), node => node.type === 'FlatList');
  const row = list.props.renderItem({ item: list.props.data[0] });
  const archiveItem = row.type(row.props).props.children[0].props.sections.at(-1).items[0];
  assert.equal(archiveItem.disabled, undefined, 'a running Chat can be archived: it is stopped first');
  row.props.onAction('archive');
  await settleAll();
  assert.deepEqual(alerts, [{ title: 'Archive this Chat?', message: '1 uncommitted file will be lost. Commit them first to keep them.', buttons: [['Cancel', 'cancel'], ['Stop, archive and delete worktree', 'destructive']] }]);
  assert.deepEqual(project.calls.map(([method]) => method), ['worktree:roots', 'worktree:status', 'agent:interrupt', 'chat:patch', 'worktree:remove', 'refresh']);
  assert.deepEqual(project.calls.find(([method]) => method === 'worktree:remove').slice(1), ['/wt/p/fix', { force: true, base: 'main', projectPath: '/p', chatId: '/p#5', seen: { uncommitted: 1, unpushed: 0, branch: 'milagre/fix', head: 'h1', removable: false } }]);
});

test('the Chat screen Archive falls back to a plain Archive on an older Mac, then leaves the Chat', async () => {
  const alerts = [];
  const project = archiveProject();
  const screen = chatHost({ alert: pressDanger(alerts), call: async (method, args) => (['worktree:roots', 'worktree:status'].includes(method) ? Promise.reject(new Error('Command is not available from mobile')) : project.call(method, args)) });
  // The turn has ended on the Mac, so nothing is stopped.
  screen.session.snapshot = { ...project.snapshot, runs: { runs: {} } };
  screen.session.client.snapshot = async () => screen.session.snapshot;
  screen.params.id = '5';
  delete screen.params.worktreeId;
  screen.render();
  const archive = find(screen.render(), node => node.type === 'ToolbarMenuAction' && node.props.children === 'Archive');
  archive.props.onPress();
  await settleAll();
  assert.deepEqual(alerts, [{ title: 'Archive this Chat?', message: undefined, buttons: [['Cancel', 'cancel'], ['Archive', 'destructive']] }]);
  assert.deepEqual(screen.calls.map(call => call.method), ['worktree:roots', 'chat:patch']);
  assert.deepEqual(screen.calls[1].args, ['/p', 5, { archived: true, unread: false }]);
  assert.equal(screen.router.replaced, '/projects');
});

test('a new Chat can switch Worktrees and keep each Worktree draft', async () => {
  const screen = chatHost();
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: 'main' }, 2: { id: 2, name: 'feature' } };
  screen.session.drafts['/p#new:2'] = 'feature draft';
  const menu = () => find(screen.render(), node => node.type === 'PullDown' && node.props.label === 'Choose branch');
  assert.ok(menu(), 'the new Chat screen must let you choose a Worktree');
  menu().props.onSelect('2');
  assert.equal(screen.params.worktreeId, '2');
  assert.equal(screen.field().value, 'feature draft');
  menu().props.onSelect('1');
  assert.equal(screen.field().value, 'first message');
  screen.send();
  assert.ok(menu().props.sections[0].items.every(item => item.disabled), 'cannot change destination during a send');
  menu().props.onSelect('2');
  assert.equal(screen.params.worktreeId, '1');
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(menu(), undefined, 'a sent Chat stays bound to its Worktree');
});

test('new Chats offer Local/New worktree and branches even with one checkout', async () => {
  const screen = chatHost({ effects: true, call: async () => ['main', 'release'] });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: 'main' } };
  const menu = label => find(screen.render(), node => node.type === 'PullDown' && node.props.label === label);
  assert.ok(menu('Choose isolation'));
  assert.equal(menu('Choose branch').props.sections[0].items[0].title, 'main');
  await settle();
  menu('Choose isolation').props.onSelect('worktree');
  const branch = menu('Choose branch');
  assert.deepEqual(Array.from(branch.props.sections[0].items, item => item.title), ['main', 'release']);
  branch.props.onSelect('release');
  assert.equal(menu('Choose branch').props.nativeTrigger.title, 'release');
  assert.equal(screen.field().value, 'first message', 'changing the base branch keeps the draft');
  assert.equal(screen.calls.filter(call => call.method === 'project:branches').length, 1);
});

test('New worktree creates from the chosen branch on first send and keeps the selected model', async () => {
  const screen = chatHost({ effects: true, call: async method => {
    if (method === 'project:branches') return ['main', 'release'];
    if (method === 'worktree:create') return { worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } };
    return { sessionId: 7 };
  } });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: 'main' } };
  screen.session.preferences['/p#new:1'] = { ...screen.session.defaults, model: 'gpt-6-astra' };
  const menu = label => find(screen.render(), node => node.type === 'PullDown' && node.props.label === label);
  menu('Choose isolation').props.onSelect('worktree');
  await settle();
  menu('Choose branch').props.onSelect('release');
  screen.send();
  assert.ok(menu('Choose isolation').props.nativeTrigger.disabled);
  await settle();
  const created = screen.calls.find(call => call.method === 'worktree:create');
  assert.equal(created.args[0].baseBranch, 'release');
  assert.equal(created.args[0].prompt, 'first message');
  const sent = screen.calls.find(call => call.method === 'chat:send').args[0];
  assert.equal(sent.worktreeId, 9);
  assert.equal(sent.sessionId, 7);
  assert.equal(sent.model, 'gpt-6-astra');
  assert.equal(screen.params.id, '7');
});

test('retrying a failed first send reuses the created worktree and keeps the draft', async () => {
  let sends = 0;
  const screen = chatHost({ effects: true, call: async method => {
    if (method === 'project:branches') return ['main'];
    if (method === 'worktree:create') return { worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } };
    if (++sends === 1) throw new Error('Connection lost');
    return { sessionId: 7 };
  } });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: 'main' } };
  find(screen.render(), node => node.type === 'PullDown' && node.props.label === 'Choose isolation').props.onSelect('worktree');
  await settle();
  screen.send(); await settle();
  assert.equal(screen.field().value, 'first message');
  assert.equal(screen.params.id, undefined);
  screen.send(); await settle();
  assert.equal(screen.calls.filter(call => call.method === 'worktree:create').length, 1);
  assert.equal(screen.params.id, '7');
});

test('a late new-worktree creation cannot send or navigate after switching Projects', async () => {
  const creating = deferred();
  const screen = chatHost({ effects: true, call: method => method === 'project:branches' ? Promise.resolve(['main']) : creating.promise });
  screen.session.snapshot.project.state.worktrees = { 1: { id: 1, name: 'main' } };
  find(screen.render(), node => node.type === 'PullDown' && node.props.label === 'Choose isolation').props.onSelect('worktree');
  await settle();
  screen.send(); await settle();
  screen.session.snapshot.project.path = '/other';
  screen.render();
  creating.resolve({ worktreeId: 9, project: { state: { sessions: { 7: { id: 7, worktree_id: 9 } } } } });
  await settle();
  assert.equal(screen.calls.filter(call => call.method === 'chat:send').length, 0);
  assert.equal(screen.params.id, undefined);
  assert.equal(screen.session.drafts['/p#new:1'], 'first message');
});

test('the attachment pull-down opens the selected picker and blocks a second pick', async () => {
  const picking = deferred();
  const kinds = [];
  const screen = chatHost({ pickAttachments: kind => { kinds.push(kind); return picking.promise; } });
  const menu = () => find(screen.render(), node => node.type === 'PullDown' && node.props.label === 'Add photos or files');
  assert.ok(menu(), 'attachments must use a pull-down anchored to the +');
  menu().props.onSelect('photos');
  assert.ok(menu().props.sections[0].items.every(item => item.disabled));
  menu().props.onSelect('files');
  assert.deepEqual(kinds, ['photos']);
  picking.resolve([]);
  await settle();
  menu().props.onSelect('camera');
  await settle();
  assert.deepEqual(kinds, ['photos', 'camera']);
  screen.session.attachments['/p#new:1'] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `${i}.txt`, uri: `file:///${i}.txt`, image: false }));
  assert.ok(menu().props.sections[0].items.every(item => item.disabled));
  menu().props.onSelect('files');
  assert.deepEqual(kinds, ['photos', 'camera'], 'four attachments block another picker');
});

test('text typed during the first send follows the created Chat into its composer', async () => {
  const screen = chatHost();
  screen.send();
  screen.field().onChangeText('next message typed during send');
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.params.id, '42');
  assert.equal(screen.field().value, 'next message typed during send');
  assert.equal(screen.session.drafts['/p#new:1'], undefined);
});

test('a successful first send clears the sent draft', async () => {
  const screen = chatHost();
  screen.send();
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.params.id, '42');
  assert.equal(screen.field().value, '');
  assert.equal(screen.session.drafts['/p#new:1'], undefined);
});

test('a failed first send keeps the current draft and releases the composer', async () => {
  const screen = chatHost();
  screen.send();
  screen.field().onChangeText('edited during failed send');
  screen.sending.reject(new Error('Connection lost'));
  await settle();
  assert.equal(screen.params.id, undefined);
  assert.equal(screen.field().value, 'edited during failed send');
  const button = find(screen.render(), node => node.type === 'IconButton' && node.props.label === 'Send message');
  assert.equal(button.props.disabled, false);
  assert.equal(find(screen.render(), node => node.type === 'ErrorNotice').props.message, 'Connection lost');
});

test('the transcript follows new content, also after the agent settings sheet opens', () => {
  const screen = chatHost();
  const tree = screen.render();
  const page = find(tree, node => node.type === 'KeyboardChatScrollView');
  let scrolls = 0;
  page.props.ref.current = { scrollToEnd() { scrolls++; } };
  page.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  page.props.onContentSizeChange(0, 400);
  assert.equal(scrolls, 0, 'a transcript shorter than the screen never scrolls');
  page.props.onContentSizeChange(0, 900);
  assert.equal(scrolls, 1);
  find(tree, node => node.type === 'AgentControls').props.onToggle();
  page.props.onContentSizeChange(0, 1000);
  assert.equal(scrolls, 2);
});

test('live tool activity opens in the activity sheet instead of expanding in the transcript', () => {
  const screen = chatHost();
  screen.params.id = '42';
  screen.session.snapshot.project.state.sessions[42] = { id: 42, provider: 'codex' };
  screen.session.snapshot.runs.runs['/p#42'] = { text: '', steps: [], approvals: [], questions: [] };
  const tree = screen.render();
  const pushed = [];
  screen.router.push = route => pushed.push(route);
  find(tree, node => node.type === 'ChatReply').props.onActivity('run');
  assert.equal(JSON.stringify(pushed), JSON.stringify([{ pathname: '/activity', params: { id: '42', message: 'run' } }]));
});

test('switching the requested diff hides old content and ignores its late response', async () => {
  const react = hookHost();
  let currentDeps, cleanup, pendingEffect;
  react.useEffect = (effect, deps) => {
    if (!currentDeps || deps.some((value, index) => value !== currentDeps[index])) {
      currentDeps = deps;
      pendingEffect = () => { cleanup?.(); cleanup = effect(); };
    }
  };
  const first = deferred(), second = deferred();
  const client = { call: (_method, args) => args[0].path === 'first' ? first.promise : second.promise };
  const { useRpc } = load('use-rpc.ts', { react });
  let file = 'first';
  const render = () => { react.begin(); const value = useRpc(client, 'git:diff-file', [{ path: file }]); const effect = pendingEffect; pendingEffect = null; effect?.(); return value; };
  assert.equal(render().loading, true);
  file = 'second';
  assert.equal(render().data, null);
  second.resolve({ patch: '+second' });
  await settle();
  assert.equal(render().data.patch, '+second');
  first.resolve({ patch: '+first' });
  await settle();
  assert.equal(render().data.patch, '+second');
  cleanup?.();
});

function worktreeFormHost() {
  const creating = deferred();
  const react = hookHost();
  let active = true, cleanup, effect, focusEffect;
  react.useEffect = fn => { effect = fn; };
  const nav = [];
  const session = {
    client: { call: method => method === 'worktree:create' ? creating.promise : Promise.resolve(['main']) },
    snapshot: { project: { path: '/A' } }, drafts: {},
    isSelected: () => active,
    open: async () => { session.snapshot.project.path = '/A'; },
    refresh: async () => {},
    setDrafts(fn) { this.drafts = fn(this.drafts); },
  };
  const { default: Form } = load('app/new-worktree.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text' },
    'expo-router': { Redirect: 'Redirect', router: { replace: route => nav.push(route) }, useFocusEffect: fn => { if (fn !== focusEffect) { cleanup?.(); cleanup = fn(); focusEffect = fn; } } },
    '../session': { useSession: () => session, useComposer: () => session }, '../attachment-picker': { pickAttachments: async () => [] }, '../attachments': require('../apps/mobile/src/attachments.ts'), '../status-indicators': { ChatStatus: 'ChatStatus', AgentStatus: 'AgentStatus', WorktreeStatus: 'WorktreeStatus' },
    '../ui': { ...Object.fromEntries(['Button', 'ErrorNotice', 'Field', 'PageScroll', 'Select'].map(name => [name, name])), styles: {} },
  });
  const render = () => { react.begin(); return Form(); };
  const field = () => find(render(), n => n.type === 'Field').props;
  const initialize = async () => { render(); effect?.(); await settle(); find(render(), n => n.type === 'Select').props.onChange('main'); field().onChangeText('original task'); };
  return { session, creating, nav, render, field, initialize,
    create() { find(render(), n => n.type === 'Button').props.onPress(); },
    leaveRoute() { cleanup?.(); },
    changeProject() { active = false; session.snapshot = { project: { path: '/B' } }; },
  };
}

test('late Worktree creation cannot select its old Project or navigate after context changes', async () => {
  for (const transition of ['changeProject', 'leaveRoute']) {
    const form = worktreeFormHost(); await form.initialize(); form.create(); form[transition]();
    form.creating.resolve({ worktreeId: 42 }); await settle();
    assert.equal(form.nav.length, 0, transition);
    if (transition === 'changeProject') assert.equal(form.session.snapshot.project.path, '/B');
  }
});

test('new Worktree Chat receives the latest prompt typed while creation is pending', async () => {
  const form = worktreeFormHost(); await form.initialize(); form.create();
  form.field().onChangeText('newer task details');
  form.creating.resolve({ worktreeId: 42 }); await settle();
  assert.equal(form.session.drafts['/A#new:42'], 'newer task details');
  assert.equal(form.nav.length, 1);
});

test('late Chat rename cannot pop another screen after its form loses focus', async () => {
  const saving = deferred(), react = hookHost();
  let cleanup, backs = 0;
  const session = { client: { call: () => saving.promise }, snapshot: { project: { path: '/A', state: { sessions: { 1: { id: 1, title: 'Chat' } } } }, runs: { runs: {} } }, isSelected: () => true, refresh: async () => {} };
  const { default: Form } = load('app/chat-details.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text' },
    'expo-router': { Redirect: 'Redirect', router: { back: () => backs++ }, useLocalSearchParams: () => ({ id: '1' }), useFocusEffect: fn => { cleanup = fn(); } },
    '../session': { useSession: () => session, useComposer: () => session }, '../attachment-picker': { pickAttachments: async () => [] }, '../attachments': require('../apps/mobile/src/attachments.ts'), '../status-indicators': { ChatStatus: 'ChatStatus', AgentStatus: 'AgentStatus', WorktreeStatus: 'WorktreeStatus' }, '../ui': { ...Object.fromEntries(['Button', 'ErrorNotice', 'Field', 'PageScroll'].map(name => [name, name])), styles: {} },
  });
  react.begin(); const tree = Form();
  find(tree, n => n.type === 'Button' && n.props.title === 'Save name').props.onPress();
  cleanup?.(); saving.resolve({}); await settle();
  assert.equal(backs, 0);
});


test('selection guards expire when Project or connection changes', async () => {
  const render = sessionHost({ call: async (method, args) => method === 'project:recent' ? [] : { path: args?.[0] }, snapshot: async p => snapshot(p) });
  await render().connect({ address: 'address', token: 'token' }); await render().open('A');
  const first = render(); assert.equal(first.isSelected(), true);
  await first.open('B'); assert.equal(first.isSelected(), false);
  const second = render(); assert.equal(second.isSelected(), true);
  await second.connect({ address: 'another-address', token: 'token' }); assert.equal(second.isSelected(), false);
});

test('attachment drafts survive a failed send and move only after a successful first send', async () => {
  const screen = chatHost();
  const photo = { id: 'photo', name: 'photo.jpg', uri: 'file:///photo', image: { id: 'photo', name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,/9j/' } };
  screen.session.attachments['/p#new:1'] = [photo];
  screen.send();
  screen.sending.reject(new Error('Connection lost'));
  await settle();
  assert.equal(screen.session.attachments['/p#new:1'][0].id, 'photo');
  assert.equal(screen.field().value, 'first message');
  const next = chatHost();
  next.session.attachments['/p#new:1'] = [photo];
  next.send();
  next.session.attachments['/p#new:1'] = [photo, { ...photo, id: 'later' }];
  next.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(next.session.attachments['/p#new:1'], undefined);
  assert.deepEqual(Array.from(next.session.attachments['/p#42'], item => item.id), ['later']);
});

test('reusing an empty Chat preserves its existing text and attachment drafts', async () => {
  const screen = chatHost();
  const photo = { id: 'a', name: 'a.jpg', uri: 'file:///a', image: { id: 'a', name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,/9j/' } };
  screen.session.attachments['/p#42'] = [photo];
  screen.session.drafts['/p#42'] = 'unsent in existing Chat';
  screen.send();
  screen.sending.resolve({ sessionId: 42 });
  await settle();
  assert.equal(screen.session.attachments['/p#42'].length, 1);
  assert.equal(screen.session.attachments['/p#42'][0], photo);
  assert.equal(screen.field().value, 'unsent in existing Chat');
});

test('notification navigation reconnects and opens the target Chat only after loading current state', async () => {
  const calls = [];
  const target = { project: { path: '/target', name: 'Target', state: { sessions: { 7: { id: 7 } } } }, runs: { runs: {} } };
  const render = sessionHost({ url: 'https://mac.example', call: async (method, args) => { calls.push({ method, args }); return method === 'project:recent' ? [] : method === 'project:open' ? { path: args[0] } : {}; }, snapshot: async () => target });
  const opened = await render().openNotificationTarget({ address: 'https://mac.example', token: 'a'.repeat(64), name: 'Mac' }, '/target', 7);
  assert.equal(opened, true);
  assert.equal(render().snapshot.project.path, '/target');
  assert.equal(render().hostName, 'Mac');
  assert.ok(calls.some(call => call.method === 'project:open' && call.args[0] === '/target'));
});

test('a later disconnect or navigation cancels an outstanding notification target', async () => {
  const loaded = deferred();
  const render = sessionHost({ url: 'https://mac.example', call: async () => [], snapshot: () => loaded.promise });
  const opening = render().openNotificationTarget({ address: 'https://mac.example', token: 'a'.repeat(64), name: 'Mac' }, '/target', 7);
  await new Promise(resolve => setTimeout(resolve, 1));
  render().cancelNavigation();
  loaded.resolve({ project: { path: '/target', state: { sessions: { 7: { id: 7 } } } } });
  assert.equal(await opening, false);
  assert.equal(render().client, null);
  assert.equal(render().snapshot, null);
});

test('notification navigation rejects a Chat that no longer exists', async () => {
  const render = sessionHost({ call: async () => [], snapshot: async () => snapshot('/target') });
  await assert.rejects(render().openNotificationTarget({ address: 'https://mac.example', token: 'a'.repeat(64), name: 'Mac' }, '/target', 7), /no longer available/);
  assert.equal(render().client, null);
});

test('a cancelled notification target ignores a later network failure', async () => {
  const loaded = deferred();
  const render = sessionHost({ call: async () => [], snapshot: () => loaded.promise });
  const opening = render().openNotificationTarget({ address: 'https://mac.example', token: 'a'.repeat(64), name: 'Mac' }, '/target', 7);
  await new Promise(resolve => setTimeout(resolve, 1));
  render().cancelNavigation();
  loaded.reject(new Error('Connection lost'));
  assert.equal(await opening, false);
});

function pushHost(t, initial = 'index') {
  const react = hookHost();
  react.useEffect = react.effect;
  react.useLayoutEffect = react.effect;
  const { StackRouter, StackActions } = require(require.resolve('expo-router/build/react-navigation/routers', { paths: [path.join(__dirname, '../apps/mobile')] }));
  const stack = StackRouter({ initialRouteName: initial });
  const options = { routeNames: ['index', 'projects', 'project', 'chat'], routeParamList: {}, routeGetIdList: {} };
  let navigation = stack.getInitialState(options);
  let pathname = initial === 'index' ? '/' : '/chat';
  let params = initial === 'chat' ? { id: '1' } : {};
  const apply = action => { navigation = stack.getStateForAction(navigation, action, options) || navigation; };
  const router = {
    dismissAll: () => apply(StackActions.popToTop()),
    replace: route => apply(StackActions.replace(route.pathname.slice(1), route.params)),
    dismissTo: path => apply(StackActions.popTo(path === '/' ? 'index' : path.slice(1))),
    push: route => apply(StackActions.push(typeof route === 'string' ? route.slice(1) : route.pathname.slice(1), route.params)),
  };
  let generation = 0, receive;
  const opening = deferred(), opens = [];
  const host = { id: 'https://mac.example', address: 'https://mac.example', token: 'a'.repeat(64), name: 'Mac', lastUsed: 0 };
  const session = { booted: true, hosts: [host], snapshot: snapshot('/project'), client: { url: host.id },
    claimAutoOpen() {}, cancelNavigation() { generation++; }, navigationVersion: () => generation,
    openNotificationTarget: async (...args) => { const current = ++generation; opens.push(args); await opening.promise; return current === generation; },
  };
  const { usePushState } = load('push.tsx', {
    react, 'react/jsx-runtime': { jsx }, 'react-native': { Alert: { alert() {} }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { router, usePathname: () => pathname, useGlobalSearchParams: () => params },
    './client': {}, './relay-native': { relayRuntime: {} }, './hosts-native': { savedHosts: { list: async () => [host] } }, './session': { useSession: () => session },
    './push-controller': require('../apps/mobile/src/push-controller.ts'),
    './push-native': { pushStore: { read: async () => ({ enabled: false, pending: [] }) }, pushNative: {
      available: () => 'Simulator', listen: async (_view, tap) => { receive = tap; return () => {}; },
    } },
  }, '\nexport { usePushState };');
  const render = () => { react.begin(); const value = usePushState(); react.flush(); return value; };
  t.after(() => react.cleanup());
  render();
  return { render, opens, opening, tap: (eventId = 'event') => { receive({ kind: 'milagre-chat', hostId: host.id, projectPath: '/project', sessionId: 2, eventId }); render(); },
    switchChat: (id, projectPath, hostId) => { params = { id, projectPath, hostId }; pathname = '/chat'; render(); }, routes: () => navigation.routes, back: () => apply({ type: 'GO_BACK' }),
    pair: () => { const current = ++generation; pathname = '/pair'; params = {}; render(); return current === generation; },
  };
}

test('a same-screen Chat switch cancels a slow notification target', async t => {
  const screen = pushHost(t, 'chat');
  screen.tap();
  await settle();
  screen.switchChat('3');
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes()[0].name, 'chat');
  assert.equal(screen.routes()[0].params, undefined);
});

test('switching Projects with the same Chat id cancels a slow notification target', async t => {
  const screen = pushHost(t, 'chat');
  screen.tap();
  await settle();
  screen.switchChat('1', '/another-project', 'https://mac.example');
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes()[0].params, undefined);
});

test('a cold-start notification opens the target directly without setup screens', async t => {
  const screen = pushHost(t);
  screen.tap();
  await settle();
  screen.opening.resolve();
  await settle();
  assert.deepEqual(screen.routes().map(route => route.name), ['chat']);
  assert.equal(screen.routes()[0].params.projectPath, '/project');
  assert.equal(screen.routes()[0].params.hostId, 'https://mac.example');
});

test('duplicate in-flight taps share one opening and a later tap can open again', async t => {
  const screen = pushHost(t);
  screen.tap();
  await settle();
  screen.tap();
  await settle();
  assert.equal(screen.opens.length, 1);
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes().at(-1).name, 'chat');
  screen.tap();
  await settle();
  assert.equal(screen.opens.length, 2);
});

test('route changes preserve a newer normal pairing while cancelling notification work', async t => {
  const screen = pushHost(t);
  assert.equal(screen.pair(), true);
  screen.tap();
  await settle();
  assert.equal(screen.pair(), true);
  screen.opening.resolve();
  await settle();
  assert.equal(screen.routes().at(-1).name, 'index');
});

test('a notification target clears an older Project loading state', async () => {
  const oldOpening = deferred();
  const render = sessionHost({
    call: async (method, args) => method === 'project:recent' ? [] : method === 'project:open' ? args[0] === '/old' ? oldOpening.promise : { path: args[0] } : {},
    snapshot: async projectPath => ({ ...snapshot(projectPath), project: { path: projectPath, state: { sessions: { 2: { id: 2 } } } } }),
  });
  await render().connect({ address: 'address', token: 'token' });
  const old = render().open('/old');
  assert.equal(render().opening.path, '/old');
  await render().openNotificationTarget({ address: 'new', token: 'new', name: 'Mac' }, '/target', 2);
  oldOpening.resolve({ path: '/old' });
  await old;
  assert.equal(render().snapshot.project.path, '/target');
  assert.equal(render().opening, null);
});

// Render the real activity adapters, disclosure and shimmer against native leaves.
function activityItemHost() {
  const hosts = new Map();
  let current;
  const react = Object.fromEntries(['useState', 'useRef', 'useMemo', 'useEffect'].map(name => [name, (...args) => current[name](...args)]));
  react.memo = fn => fn;
  const palette = { ink: '#fff', ink2: '#aaa', ink3: '#666', field: '#222', red: '#f00', orange: '#f80' };
  const native = { Text: 'Text', View: 'View', Pressable: 'Pressable', useColorScheme: () => 'dark', AccessibilityInfo: {}, StyleSheet: { create: value => value, absoluteFill: {} }, Animated: { Value: class { interpolate() {} }, View: 'AnimatedView' }, Easing: { bezier: () => () => {}, linear() {} } };
  const icons = new Proxy({}, { get: (_, key) => key });
  const common = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native, '@hugeicons/core-free-icons': icons, '@milagre/shared/reply-parts': require('@milagre/shared/reply-parts'), './icons': { Icon: 'Icon', SpinnerRing: 'SpinnerRing' }, './ui': { colors: palette, styles: { code: {}, caption: {}, label: {}, muted: {} }, PageScroll: 'ScrollView' } };
  const running = load('running-logo.tsx', { ...common, 'react-native-svg': { default: 'Svg', Path: 'Path' }, '@react-native-masked-view/masked-view': { __esModule: true, default: 'MaskedView' }, 'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, 'expo-router': { useIsFocused: () => false }, './logo': { LEFT: '', RIGHT: '', STAR: '', STAR_BOX: {} }, './theme': { colors: palette, fonts: { mono: 'mono' }, hex: () => palette } });
  const shared = load('activity-item.tsx', { ...common, './running-logo': running, './theme': { fonts: { mono: 'mono' } } });
  const SubagentItem = load('subagent-item.tsx', { ...common, './activity-item': shared }).SubagentItem;
  const ToolRow = load('tool-row.tsx', { ...common, './activity-item': shared, './markdown': { Markdown: ({ text }) => jsx('Text', { children: text }) } }).ToolRow;
  function visit(node, key) {
    if (Array.isArray(node)) return node.map((child, index) => visit(child, `${key}.${child?.props?.id || index}`));
    if (!node || typeof node !== 'object' || !node.type) return node;
    if (typeof node.type === 'function') {
      current = hosts.get(key) || hookHost();
      hosts.set(key, current); current.begin();
      return visit(node.type(node.props), `${key}.render`);
    }
    return { ...node, props: { ...node.props, children: visit(node.props?.children, `${key}.children`) } };
  }
  return { subagent: agent => visit(jsx(SubagentItem, { agent }), 'agent'), tool: props => visit(jsx(ToolRow, props), 'tool') };
}
const sampleSubagent = { id: 'a', title: 'Check the phone connection', status: 'running', startedAt: 1, updatedAt: 1, latestActivity: 'Checking pairing', transcript: [{ id: 't', kind: 'message', text: 'Connection verified.' }] };

test('subagent execution shimmers, while waiting, failure and completion stop it', () => {
  const item = activityItemHost();
  for (const status of ['initializing', 'running']) assert.ok(find(item.subagent({ ...sampleSubagent, status }), node => node.type === 'MaskedView'), status);
  for (const status of ['waiting', 'failed', 'completed', 'cancelled']) assert.equal(find(item.subagent({ ...sampleSubagent, status }), node => node.type === 'MaskedView'), undefined, status);
});

test('subagent details stay expanded across live updates and collapse through the disclosure', () => {
  const item = activityItemHost();
  let tree = item.subagent(sampleSubagent);
  assert.equal(find(tree, node => node.type === 'Text' && node.props.children === 'Connection verified.'), undefined);
  find(tree, node => node.props?.accessibilityRole === 'button').props.onPress();
  tree = item.subagent({ ...sampleSubagent, status: 'completed', transcript: [{ id: 't', kind: 'message', text: 'New live output' }] });
  assert.ok(find(tree, node => node.type === 'Text' && node.props.children === 'New live output'));
  assert.equal(find(tree, node => node.props?.accessibilityRole === 'button').props.accessibilityState.expanded, true);
  find(tree, node => node.props?.accessibilityRole === 'button').props.onPress();
  assert.equal(find(item.subagent(sampleSubagent), node => node.type === 'Text' && node.props.children === 'Connection verified.'), undefined);
});

test('tool disclosure reveals late output, while its chat action opens Activity without expanding', () => {
  const item = activityItemHost();
  const props = { step: { id: 's', kind: 'shell', title: 'Ran `npm test`', status: 'running', hasDetail: true }, live: false, waiting: false };
  let tree = item.tool(props);
  find(tree, node => node.props?.accessibilityRole === 'button').props.onPress();
  assert.ok(find(item.tool(props), node => node.type === 'Text' && node.props.children === 'Loading output…'));
  tree = item.tool({ ...props, step: { ...props.step, detail: '51 tests passed', status: 'done' }, live: false });
  assert.ok(find(tree, node => node.type === 'Text' && node.props.children === '51 tests passed'));
  assert.equal(find(tree, node => node.type === 'MaskedView'), undefined);
  let opened = 0;
  const navigated = activityItemHost();
  tree = navigated.tool({ ...props, step: { ...props.step, detail: 'Tool output' }, onPress: () => { opened++; } });
  find(tree, node => node.props?.accessibilityRole === 'button').props.onPress();
  assert.equal(opened, 1);
  assert.equal(find(navigated.tool({ ...props, onPress: () => {} }), node => node.type === 'ScrollView'), undefined);
});

function updatesHost() {
  const react = hookHost();
  const listeners = new Set();
  const state = { status: 'idle', error: '' };
  const appState = { currentState: 'active', addEventListener: (_, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  let reloads = 0, retries = 0;
  const { UpdateSheet, useUpdatePresentation } = load('update-sheet.tsx', {
    react: { ...react, useEffect: react.effect, useSyncExternalStore: (_, get) => get() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Text: 'Text', Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', useColorScheme: () => 'dark',
      AppState: appState },
    'expo-router': {},
    'expo-updates': {}, './update-controller': {}, './theme': { colors: {}, hex: () => ({ page: '#17181a' }) },
    './ui': { PillButton: 'PillButton' },
  });
  return {
    set(status, error = '') { state.status = status; state.error = error; },
    render() {
      react.begin(); useUpdatePresentation(state); react.flush();
      react.begin(); useUpdatePresentation(state);
      react.begin(); const presentation = useUpdatePresentation(state);
      const content = UpdateSheet({ state, onUpdate: () => { reloads++; }, onRetry: () => { retries++; }, onDismiss: presentation.dismiss });
      return { ...presentation, content };
    },
    foreground() { appState.currentState = 'active'; for (const listener of listeners) listener('active'); },
    background() { appState.currentState = 'background'; for (const listener of listeners) listener('background'); },
    cleanup: react.cleanup, listeners, reloads: () => reloads, retries: () => retries,
  };
}

test('the update sheet opens only for an actionable update and Later lasts until foreground entry', () => {
  const host = updatesHost();
  for (const status of ['idle', 'checking', 'downloading', 'up-to-date', 'disabled']) {
    host.set(status);
    assert.equal(host.render().presented, false, status);
  }
  host.set('ready');
  const ready = host.render();
  assert.equal(ready.presented, true);
  find(ready.content, node => node.type === 'PillButton' && node.props.title === 'Later').props.onPress();
  assert.equal(host.render().presented, false);
  host.background();
  assert.equal(host.render().presented, false);
  host.foreground();
  assert.equal(host.render().presented, true);
  host.render().dismiss();
  assert.equal(host.render().presented, false, 'swipe dismissal behaves like Later');
  assert.equal(host.reloads(), 0);
  host.cleanup();
  assert.equal(host.listeners.size, 0);
});

test('an update downloaded in the background waits until foreground entry to present', () => {
  const host = updatesHost();
  host.render(); host.background(); host.set('ready');
  assert.equal(host.render().presented, false);
  host.foreground();
  assert.equal(host.render().presented, true);
  host.cleanup();
});

test('Later during retry stays dismissed when the download finishes or polling fails', () => {
  for (const final of ['ready', 'error']) {
    const host = updatesHost();
    host.set('error'); host.render(); host.set('downloading');
    find(host.render().content, node => node.type === 'PillButton' && node.props.title === 'Later').props.onPress();
    host.set(final);
    assert.equal(host.render().presented, false);
    host.foreground();
    assert.equal(host.render().presented, true);
    host.cleanup();
  }
});

test('sheet actions apply or retry, keep progress visible, and recover from reload errors', () => {
  const host = updatesHost();
  host.set('error', 'Could not download the update. Try again.');
  assert.equal(host.render().presented, true);
  find(host.render().content, node => node.type === 'PillButton' && node.props.title === 'Try again').props.onPress();
  assert.equal(host.retries(), 1);
  for (const status of ['checking', 'downloading']) {
    host.set(status);
    const progress = host.render();
    assert.equal(progress.presented, true);
    assert.ok(find(progress.content, node => node.type === 'ActivityIndicator'));
    assert.equal(find(progress.content, node => node.type === 'PillButton' && node.props.title === 'Try again'), undefined);
  }
  host.set('ready');
  find(host.render().content, node => node.type === 'PillButton' && node.props.title === 'Update now').props.onPress();
  assert.equal(host.reloads(), 1);
  host.set('restarting');
  assert.ok(find(host.render().content, node => node.type === 'ActivityIndicator'));
  assert.equal(find(host.render().content, node => node.type === 'PillButton'), undefined);
  host.set('ready', 'Could not apply the update. Try again.');
  const failed = host.render();
  assert.ok(find(failed.content, node => node.props?.accessibilityRole === 'alert'));
  find(failed.content, node => node.type === 'PillButton' && node.props.title === 'Try again').props.onPress();
  assert.equal(host.reloads(), 2);
  assert.equal(host.retries(), 1, 'a reload failure must retry the downloaded update');
  host.cleanup();
});

test('the global shell waits for navigation, pushes once, and preserves each current page', () => {
  const react = hookHost();
  let created = 0, navigation;
  const routes = [], resets = [];
  let latestTree;
  let navigationListener;
  const navigationRef = {
    getRootState: () => ({ key: 'generated-root', routes: [{ name: '__root', state: navigation }] }),
    addListener: (_, listener) => { navigationListener = listener; return () => { navigationListener = undefined; }; },
    dispatch: action => { assert.equal(action.target, 'root'); resets.push(action.payload); navigation = action.payload; },
  };
  const state = { status: 'ready', error: '' };
  const shell = load('update-sheet.tsx', {
    react: { ...react, useEffect: react.effect, createContext: () => ({ Provider: 'UpdatesProvider' }), useSyncExternalStore: (_, get) => get() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { router: { push: route => routes.push(route) }, useRootNavigationState: () => navigation, useNavigationContainerRef: () => navigationRef },
    'expo-updates': { isEnabled: true, useUpdates: () => ({}) },
    './update-controller': { watchUpdates: () => () => {}, createUpdateController: () => { created++; return { subscribe() {}, get: () => state, install() {}, check() {}, syncNative() {} }; } },
    './theme': { colors: {} }, './ui': {},
  }, '\nconst __DEV__ = false;').UpdateShell;
  for (const page of ['Computers', 'Chat', 'Settings']) {
    react.begin();
    const navigator = jsx('Stack', { page });
    const tree = latestTree = shell({ children: navigator });
    assert.equal(tree.props.children, navigator);
    assert.equal(tree.props.value.state, state);
    react.flush();
    if (!navigation) { assert.deepEqual(routes, []); navigation = { key: 'root', routeNames: ['index', 'update-sheet', 'projects'], index: 0, routes: [{ key: 'computers', name: 'index' }] }; navigationListener(); }
  }
  assert.equal(created, 1, 'navigation keeps one update controller');
  assert.deepEqual(routes, ['/update-sheet'], 'pending updates push one sheet above the current route');
  const updateRoute = { key: 'pending-update', name: 'update-sheet' };
  const destination = { key: 'connected-projects', name: 'projects', params: { host: 'saved' } };
  navigation = { ...navigation, index: 2, routes: [...navigation.routes, updateRoute, destination] };
  navigationListener();
  react.begin(); shell({ children: jsx('Stack', {}) }); react.flush();
  assert.equal(resets.length, 1);
  assert.equal(navigation.index, 2);
  assert.equal(navigation.routes[1], destination, 'late navigation retains the destination and its params');
  assert.equal(navigation.routes[2].name, 'update-sheet');
  assert.equal(navigation.routes.filter(route => route.name === 'update-sheet').length, 1, 'late navigation retains one prompt');
  react.begin(); shell({ children: jsx('Stack', {}) }); react.flush();
  navigationListener();
  assert.equal(resets.length, 1, 'the focused sheet does not reset navigation again');
  navigation = { ...navigation, index: 0, routes: [navigation.routes[0]] };
  navigationListener();
  assert.equal(routes.length, 2, 'a notification reset restores the pending prompt');
  latestTree.props.value.dismiss();
  navigationListener();
  assert.equal(routes.length, 2, 'explicit dismissal stops navigation from reopening the prompt');
  react.cleanup();
  assert.equal(navigationListener, undefined);
});

test('Later, swipe and Android back defer; notification reset and route replacement do not', () => {
  const react = hookHost();
  let dismissals = 0, backs = 0, beforeRemove;
  const dismiss = () => { dismissals++; };
  const navigation = { addListener: (_, listener) => { beforeRemove = listener; return () => { beforeRemove = undefined; }; } };
  const state = { status: 'ready', error: '' };
  const route = load('app/update-sheet.tsx', {
    react: { ...react, useEffect: react.effect },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { router: { back: () => { backs++; } }, useNavigation: () => navigation },
    '../update-sheet': { UpdateSheet: 'UpdateSheet', useAppUpdates: () => ({ state, check() {}, install() {}, dismiss }) },
  }).default;
  react.begin(); const tree = route(); react.flush();
  for (const type of ['RESET', 'POP_TO']) beforeRemove({ data: { action: { type } } });
  assert.equal(dismissals, 0, 'programmatic navigation keeps the prompt pending');
  for (const type of ['GO_BACK', 'POP']) beforeRemove({ data: { action: { type } } });
  assert.equal(dismissals, 2);
  tree.props.onDismiss();
  assert.equal(backs, 1);
  assert.equal(dismissals, 3, 'Later defers before removing its route');
  state.status = 'restarting'; react.begin(); route(); react.flush();
  assert.equal(dismissals, 3);
  react.cleanup();
  assert.equal(dismissals, 3, 'replacing a native sheet route does not defer the prompt');
  assert.equal(beforeRemove, undefined);
});

test('a live turn\'s step whose output the phone left out does not expand, while saved and clipped steps do', () => {
  const pending = 'Output appears when the turn finishes.';
  const note = tree => find(tree, node => node.type === 'Text' && node.props.children === pending);
  const button = tree => find(tree, node => node.props?.accessibilityRole === 'button');
  const step = { id: 's', kind: 'shell', title: 'Ran `npm test`', status: 'done', hasDetail: true };
  // Live and slimmed: a muted line, no disclosure, and nothing that loads.
  const item = activityItemHost();
  let tree = item.tool({ step, live: true, waiting: false });
  assert.ok(note(tree));
  assert.equal(button(tree), undefined, 'not expandable');
  assert.equal(find(tree, node => node.type === 'Text' && node.props.children === 'Loading output…'), undefined);
  // In the chat the row opens Activity, which says it, so the chat row stays as it was.
  const chat = activityItemHost().tool({ step, live: true, waiting: false, onPress: () => {} });
  assert.equal(note(chat), undefined);
  // Live with its clipped tail kept: expands and shows it.
  const kept = activityItemHost();
  tree = kept.tool({ step: { ...step, hasDetail: undefined, detail: '…tail of the log' }, live: true, waiting: false });
  assert.equal(note(tree), undefined);
  button(tree).props.onPress();
  assert.ok(find(kept.tool({ step: { ...step, hasDetail: undefined, detail: '…tail of the log' }, live: true, waiting: false }), node => node.type === 'Text' && node.props.children === '…tail of the log'));
  // Saved message: hasDetail still means "fetch", shown as loading while it does.
  const saved = activityItemHost();
  tree = saved.tool({ step, live: false, waiting: false });
  assert.equal(note(tree), undefined);
  button(tree).props.onPress();
  assert.ok(find(saved.tool({ step, live: false, waiting: false }), node => node.type === 'Text' && node.props.children === 'Loading output…'));
});

test('relay transports: one per Mac, replaced by a new code, closed in the background and on forget', async () => {
  const listeners = [], made = [];
  const identity = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
  const phoneRandom = n => new Uint8Array(n);
  const { relayRuntime } = load('relay-native.ts', {
    'react-native': { AppState: { addEventListener: (_event, listener) => { listeners.push(listener); return { remove() {} }; } } },
    'expo-file-system': { Directory: class {}, File: class {}, Paths: {} },
    './relay-transport': { createRelayTransport: options => { const transport = { options, closed: 0, close() { transport.closed++; } }; made.push(transport); return transport; } },
    './phone-identity': { phoneIdentity: async () => identity, phoneRandom },
  });
  const link = (hostId, key = 'K'.repeat(43)) => ({ url: 'wss://relay.milagre.cloud', hostId, key });
  const a = await relayRuntime.transport({ relay: link('A'.repeat(22)), token: 'a'.repeat(64) });
  assert.equal(await relayRuntime.transport({ relay: link('A'.repeat(22)), token: 'a'.repeat(64) }), a, 'one transport per Mac');
  assert.equal(a.options.identity, identity);
  assert.equal(a.options.random, phoneRandom);
  assert.equal(a.options.hostId, 'A'.repeat(22));
  const b = await relayRuntime.transport({ relay: link('B'.repeat(22)), token: 'a'.repeat(64) });
  assert.notEqual(b, a);
  // A new pairing code for the same Mac replaces its transport.
  const a2 = await relayRuntime.transport({ relay: link('A'.repeat(22)), token: 'c'.repeat(64) });
  assert.notEqual(a2, a);
  assert.equal(a.closed, 1);
  // The background closes every open transport; they stay in place to reopen on the next request.
  for (const listener of listeners) listener('inactive');
  assert.deepEqual([a2.closed, b.closed], [0, 0]);
  for (const listener of listeners) listener('background');
  assert.deepEqual([a2.closed, b.closed], [1, 1]);
  assert.equal(await relayRuntime.transport({ relay: link('B'.repeat(22)), token: 'a'.repeat(64) }), b);
  // Forget closes the transport and drops it: the next use builds a new one.
  relayRuntime.forget('B'.repeat(22));
  assert.equal(b.closed, 2);
  const b2 = await relayRuntime.transport({ relay: link('B'.repeat(22)), token: 'a'.repeat(64) });
  assert.notEqual(b2, b);
  relayRuntime.forget('nobody');
  for (const listener of listeners) listener('background');
  assert.equal(b.closed, 2, 'a forgotten transport is not closed again');
});

test('refreshing saved hosts during startup cannot cancel the claimed auto-open', async () => {
  const react = hookHost(); react.useEffect = react.effect;
  const host = { id: 'mac', address: 'mac', name: 'Mac', token: 'token' };
  const opened = [], routes = [];
  let claimed = false;
  const session = { booted: true, hosts: [host], lastLocation: { hostId: 'mac', projectPath: '/p', chatId: 1 }, client: null,
    loadHosts: async () => [host], connect: async value => { opened.push(value.id); return true; },
    claimAutoOpen: () => { if (claimed) return false; claimed = true; return true; }, navigationVersion: () => 0,
  };
  const { default: Screen } = load('app/index.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: {}, Platform: { OS: 'ios' }, RefreshControl: 'RefreshControl', Text: 'Text', View: 'View' },
    'expo-router': { Stack: { Screen: 'Screen', Toolbar: Object.assign(() => null, { Button: 'Button', Spacer: 'Spacer' }) }, router: { replace: route => routes.push(route) }, useFocusEffect() {} },
    '@hugeicons/core-free-icons': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../session': { useSession: () => session }, '../push': { usePush: () => ({}) }, '../hosts-native': { savedHosts: {} }, '../client': {}, '../relay-native': {}, '../icons': { Icon: 'Icon' },
    '../ui': { colors: {}, styles: {}, ErrorNotice: 'ErrorNotice', ListRow: 'ListRow', PageScroll: 'PageScroll' },
  });
  react.begin(); Screen(); react.flush();
  session.hosts = [...session.hosts];
  react.begin(); Screen(); react.flush();
  await settle();
  assert.deepEqual(opened, ['mac']);
  assert.equal(routes[0].pathname, '/projects');
  assert.equal(routes[0].params.resume, '1');
  react.cleanup();
});
