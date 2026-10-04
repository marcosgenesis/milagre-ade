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

function markdownHost() {
  const react = { ...hookHost(), memo: fn => fn };
  const viewer = require('../apps/mobile/src/viewer-store.ts');
  const routes = [], links = [];
  const { Markdown } = load('markdown.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', Alert: {}, Linking: { openURL: async url => { links.push(url); } } },
    'expo-router': { router: { push: route => routes.push(route) } }, './viewer-store': viewer,
    './chat-presentation': require('../apps/mobile/src/chat-presentation.ts'),
    './ui': { PageScroll: 'PageScroll', colors: {}, styles: { muted: {}, code: {} } },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return { render(text) { react.begin(); return expand(Markdown({ text })); }, routes, links, viewer };
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

function sessionHost(client, { effects = false, AppState = {} } = {}) {
  const react = hookHost({ effects });
  const { useSessionState } = load('session.tsx', {
    react, '@milagre/shared/reconcile': require('@milagre/shared/reconcile'), 'react/jsx-runtime': { jsx }, 'react-native': { AppState }, './client': { createClient: () => client }, './live': require('../apps/mobile/src/live.ts'),
    './hosts-native': { savedHosts: { save: async () => {}, list: async () => [] }, readPermission: async () => null, savePermission: async () => {} },
    './turn-options': require('../apps/mobile/src/turn-options.ts'), '@milagre/shared/model': {},
  }, '\nexport { useSessionState };');
  return Object.assign(() => { react.begin(); return useSessionState(); }, { unmount: react.unmount });
}

test('a poll from the previous Project cannot restore it after another Project opens', async () => {
  const openingB = deferred(), pollingA = deferred();
  let delayA = false;
  const render = sessionHost({
    call: async (method, args) => method === 'project:recent' ? [] : method === 'project:open' ? (args[0] === 'B' ? openingB.promise : { path: 'A' }) : {},
    snapshot: async projectPath => projectPath === 'A' && delayA ? pollingA.promise : snapshot(projectPath),
  });
  await render().connect('address', 'token');
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
  await render().connect('address', 'token');
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
  const connecting = render().connect('address', 'token');
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
function chatHost() {
  const sending = deferred();
  const params = { worktreeId: '1' };
  const session = {
    client: { call: () => sending.promise },
    snapshot: { project: { path: '/p', name: 'P', state: { sessions: {}, messages: [], worktrees: {} } }, runs: { runs: {} } },
    drafts: { '/p#new:1': 'first message' },
    attachments: {}, setAttachments(fn) { this.attachments = fn(this.attachments); },
    preferences: {}, defaults: require('../apps/mobile/src/turn-options.ts').defaultPreferences, setDefaultPermission() {}, models: null, cliStatus: null,
    setPreferences(fn) { this.preferences = fn(this.preferences); },
    setDrafts(fn) { this.drafts = fn(this.drafts); },
    refresh: async () => { session.snapshot.project.state.sessions[42] = { id: 42, provider: 'codex' }; }, expectActivity() {},
  };
  const react = hookHost();
  const ui = { ...Object.fromEntries(['Button', 'IconButton', 'ErrorNotice', 'Field', 'PageScroll', 'PillButton', 'PullDown', 'HeaderButton'].map(name => [name, name])), styles: { code: {} }, colors: {} };
  const native = { ...Object.fromEntries(['KeyboardAvoidingView', 'Text', 'View', 'Image'].map(name => [name, name])), Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Alert: {}, Linking: {}, StyleSheet: { absoluteFill: {} } };
  const icons = new Proxy({}, { get: (_, name) => String(name) });
  const router = { setParams: values => Object.assign(params, values), push() {} };
  const { default: ChatScreen } = load('app/chat.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen', Toolbar: Object.assign(() => null, { Menu: 'ToolbarMenu', MenuAction: 'ToolbarMenuAction', Button: 'ToolbarButton' }) }, router, useLocalSearchParams: () => params },
    '@hugeicons/core-free-icons': icons, '@milagre/shared/pr-blockers': require('@milagre/shared/pr-blockers'), '../indicators': require('../apps/mobile/src/indicators.ts'), '../icons': { Icon: 'Icon' }, '../bottom-fade': { BottomFade: 'BottomFade', EdgeFade: 'EdgeFade' }, '../slide-over': { SlideOver: ({ children }) => children }, './changes': { ChangesView: 'ChangesView' }, '../dot-background': { useDotBackground: () => ({}) }, 'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardStickyView: 'KeyboardStickyView' }, '../running-logo': { ThinkingIndicator: 'ThinkingIndicator' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@milagre/shared/model': { MODEL_CATALOG: [{ id: 'model', provider: 'codex' }] },
    '@milagre/shared/agent-runs': { lastUserModel: () => '' }, '@milagre/shared/chats': { isListedChat: (_chat, count) => count > 0 }, '../session': { useSession: () => session, useComposer: () => session }, '../attachment-picker': { pickAttachments: async () => [] }, '../attachments': require('../apps/mobile/src/attachments.ts'), '../status-indicators': { PullRequestAction: 'PullRequestAction', SubagentChip: 'SubagentChip', usePullRequest: () => null }, '../questions': { Approval: 'Approval', Questions: 'Questions' }, '../chat-reply': { ChatReply: 'ChatReply' }, '../ui': ui, '../agent-controls': { AgentControls: 'AgentControls', PermissionChip: 'PermissionChip' }, '../turn-options': require('../apps/mobile/src/turn-options.ts'),
  });
  const render = () => { react.begin(); return ChatScreen(); };
  const field = () => find(render(), node => node.type === 'Field' && node.props.label === 'Message').props;
  const send = () => find(render(), node => node.type === 'IconButton' && node.props.label === 'Send message').props.onPress();
  return { session, sending, params, field, send, render, router };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

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
  await render().connect('address', 'token'); await render().open('A');
  const first = render(); assert.equal(first.isSelected(), true);
  await first.open('B'); assert.equal(first.isSelected(), false);
  const second = render(); assert.equal(second.isSelected(), true);
  await second.connect('another-address', 'token'); assert.equal(second.isSelected(), false);
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
    './client': {}, './hosts-native': { savedHosts: { list: async () => [host] } }, './session': { useSession: () => session },
    './push-controller': require('../apps/mobile/src/push-controller.ts'),
    './push-native': { pushStore: { read: async () => ({ enabled: false, pending: [] }) }, pushNative: {
      available: () => 'Simulator', listen: async (_view, tap) => { receive = tap; return () => {}; },
    } },
  }, '\nexport { usePushState };');
  const render = () => { react.begin(); const value = usePushState(); react.flush(); return value; };
  t.after(() => react.cleanup());
  render();
  return { render, opens, opening, tap: (eventId = 'event') => { receive({ kind: 'milagre-chat', hostId: host.id, projectPath: '/project', sessionId: 2, eventId }); render(); },
    switchChat: id => { params = { id }; pathname = '/chat'; render(); }, routes: () => navigation.routes, back: () => apply({ type: 'GO_BACK' }),
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

test('a cold-start notification builds a route back to All Chats', async t => {
  const screen = pushHost(t);
  screen.tap();
  await settle();
  screen.opening.resolve();
  await settle();
  assert.deepEqual(screen.routes().map(route => route.name), ['index', 'projects', 'project', 'chat']);
  screen.back();
  assert.equal(screen.routes().at(-1).name, 'project');
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
  await render().connect('address', 'token');
  const old = render().open('/old');
  assert.equal(render().opening.path, '/old');
  await render().openNotificationTarget({ address: 'new', token: 'new', name: 'Mac' }, '/target', 2);
  oldOpening.resolve({ path: '/old' });
  await old;
  assert.equal(render().snapshot.project.path, '/target');
  assert.equal(render().opening, null);
});
