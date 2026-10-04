const fs = require('node:fs/promises');
const path = require('node:path');
const { projectOfKey } = require('@milagre/shared/agent-runs');

const REFUSED = 'This demo computer only opens its demo project.';
const refused = () => Object.assign(new Error(REFUSED), { status: 403 });
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const realOrNull = async file => { try { return await fs.realpath(file); } catch { return null; } };

const chatProject = chatId => (typeof chatId === 'string' ? projectOfKey(chatId) : null);
// A file the phone attached: inside the folder, or one it uploaded itself.
const attached = file => ({ file });
const none = () => [];

/**
 * The paths in each command the phone may call, by argument shape (see core's runtime). A command missing here is
 * refused while the bridge is confined, so a command added to the bridge later stays closed until it is listed.
 */
const PATHS = Object.freeze({
  'push:register': none,
  'push:unregister': none,
  'push:focus': ([value]) => (value?.chatId === null || value?.chatId === undefined ? [] : [chatProject(value.chatId)]),
  'daemon:status': none,
  'project:recent': none,
  'project:open': ([projectPath]) => [projectPath],
  'chat:runs': none,
  'chat:send': ([request]) => [request?.projectPath, ...(request?.cwd === undefined ? [] : [request.cwd]), ...(Array.isArray(request?.files) ? request.files.map(attached) : [])],
  'chat:resume': ([projectPath]) => [projectPath],
  'agent:interrupt': ([chatId]) => [chatProject(chatId)],
  'agent:respond-permission': ([value]) => [chatProject(value?.chatId)],
  'usage:read': none,
  'usage:cached': none,
  'agent:answer-question': ([value]) => [chatProject(value?.chatId)],
  'agent:set-permission-mode': ([value]) => [chatProject(value?.chatId)],
  'agent:models': none,
  'agent:cli-status': none,
  'chat:patch': ([projectPath]) => [projectPath],
  'worktree:pull-request': ([worktreePath]) => [worktreePath],
  'project:branches': ([projectPath]) => [projectPath],
  'worktree:create': ([value]) => [value?.projectPath],
  'git:diff-files': ([value]) => [value?.cwd],
  'git:diff-file': ([value]) => [value?.cwd],
});

/**
 * Keeps a paired phone inside one folder: every project path, worktree path, cwd and file path it sends must resolve
 * (after realpath, so `..` and symlinks cannot lead out) inside `allowedRoot`. Files the phone uploaded itself
 * (`uploadsDir`) may also be attached and shown. Anything else is a 403.
 */
function createConfinement({ allowedRoot, uploadsDir }) {
  if (typeof allowedRoot !== 'string' || !path.isAbsolute(allowedRoot)) throw new Error('allowedRoot must be an absolute path');
  let root;
  const realRoot = async () => {
    root ??= await fs.realpath(allowedRoot).catch(() => { throw new Error(`allowedRoot does not exist: ${allowedRoot}`); });
    return root;
  };

  /** Whether `target` resolves inside the folder (or, with `uploads`, inside the phone's own uploads). */
  async function allows(target, { uploads = false } = {}) {
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) return false;
    const real = await realOrNull(target);
    if (!real) return false;
    if (inside(await realRoot(), real)) return true;
    if (!uploads || !uploadsDir) return false;
    const uploadsReal = await realOrNull(uploadsDir);
    return Boolean(uploadsReal && inside(uploadsReal, real));
  }

  async function check(target, options) {
    if (!(await allows(target, options))) throw refused();
  }

  async function checkCall(method, args) {
    const paths = PATHS[method];
    if (!paths || !Array.isArray(args)) throw refused();
    for (const item of paths(args)) {
      if (item && typeof item === 'object' && 'file' in item) await check(item.file, { uploads: true });
      else await check(item);
    }
  }

  /** What a command answers, cut down to the folder: the recent list and the turns running elsewhere. */
  async function filterResult(method, result) {
    if (method === 'project:recent' && Array.isArray(result)) {
      const kept = await Promise.all(result.map(entry => allows(entry?.path)));
      return result.filter((_entry, index) => kept[index]);
    }
    if (method === 'chat:runs' && result && typeof result === 'object' && result.runs && typeof result.runs === 'object') {
      const entries = Object.entries(result.runs);
      const kept = await Promise.all(entries.map(([chatId]) => allows(chatProject(chatId))));
      return { ...result, runs: Object.fromEntries(entries.filter((_entry, index) => kept[index])) };
    }
    return result;
  }

  return { allows, check, checkCall, filterResult, root: realRoot };
}

module.exports = { createConfinement, PATHS, REFUSED };
