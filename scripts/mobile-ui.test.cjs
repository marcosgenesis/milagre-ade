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
function hookHost() {
  const slots = [];
  let cursor = 0;
  return {
    begin() { cursor = 0; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect() {}, createContext() { return {}; }, useContext() {},
  };
}
function load(file, modules, extra = '') {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps/mobile/src', file), 'utf8') + extra;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    assert.ok(id in modules, `Unexpected import: ${id}`);
    return modules[id];
  }, process: { env: {} }, setTimeout, clearTimeout });
  return exports;
}
const jsx = (type, props) => ({ type, props });
const snapshot = projectPath => ({ project: { path: projectPath, state: { sessions: {} } }, runs: { runs: {} } });

function sessionHost(client) {
  const react = hookHost();
  const { useSessionState } = load('session.tsx', {
    react, 'react/jsx-runtime': { jsx }, 'react-native': { AppState: {} }, './client': { createClient: () => client },
    './connection-native': { savedConnection: { save: async () => {}, forget: async () => {} } },
  }, '\nexport { useSessionState };');
  return () => { react.begin(); return useSessionState(); };
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
    snapshot: { project: { path: '/p', name: 'P', state: { sessions: {}, messages: [] } }, runs: { runs: {} } },
    drafts: { '/p#new:1': 'first message' },
    preferences: {}, models: null, cliStatus: null,
    setPreferences(fn) { this.preferences = fn(this.preferences); },
    setDrafts(fn) { this.drafts = fn(this.drafts); },
    refresh: async () => { session.snapshot.project.state.sessions[42] = { id: 42, provider: 'codex' }; },
  };
  const react = hookHost();
  const ui = { ...Object.fromEntries(['Button', 'Choice', 'ErrorNotice', 'Field', 'PageScroll'].map(name => [name, name])), styles: {}, colors: {} };
  const native = { ...Object.fromEntries(['KeyboardAvoidingView', 'Text', 'View'].map(name => [name, name])), Platform: { OS: 'ios' }, Keyboard: { dismiss() {} } };
  const { default: ChatScreen } = load('app/chat.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen' }, router: { setParams: values => Object.assign(params, values) }, useLocalSearchParams: () => params },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@milagre/shared/model': { MODEL_CATALOG: [{ id: 'model', provider: 'codex' }] },
    '@milagre/shared/agent-runs': { lastUserModel: () => '' }, '../session': { useSession: () => session }, '../questions': {}, '../ui': ui, '../agent-controls': { AgentControls: 'AgentControls' }, '../turn-options': require('../apps/mobile/src/turn-options.ts'),
  });
  const render = () => { react.begin(); return ChatScreen(); };
  const field = () => find(render(), node => node.type === 'Field' && node.props.label === 'Message').props;
  const send = () => find(render(), node => node.type === 'Button' && node.props.title === 'Send message').props.onPress();
  return { session, sending, params, field, send, render };
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
  const button = find(screen.render(), node => node.type === 'Button' && node.props.title === 'Send message');
  assert.equal(button.props.disabled, false);
  assert.equal(find(screen.render(), node => node.type === 'ErrorNotice').props.message, 'Connection lost');
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
