const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const run = promisify(execFile);

function createFileSearch({ now = Date.now, ttl = 5000 } = {}) {
  const cache = new Map();
  return async (root, query = '', limit = 30) => {
    if (typeof root !== 'string' || !path.isAbsolute(root) || typeof query !== 'string') throw new Error('Choose a worktree to search.');
    let entry = cache.get(root);
    if (!entry || now() - entry.at > ttl) {
      const promise = run('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 })
        .then(({ stdout }) => [...new Set(stdout.split('\0').filter(Boolean))]);
      entry = { at: now(), promise };
      cache.set(root, entry);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      promise.catch(() => { if (cache.get(root) === entry) cache.delete(root); });
    }
    const files = await entry.promise;
    const q = query.toLowerCase().slice(0, 256);
    const score = file => {
      const name = path.basename(file).toLowerCase();
      return name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;
    };
    return files.filter(file => file.toLowerCase().includes(q)).sort((a, b) => score(a) - score(b) || path.basename(a).length - path.basename(b).length || a.localeCompare(b)).slice(0, Math.min(50, Math.max(1, Number.isFinite(limit) ? limit : 30)));
  };
}
module.exports = { createFileSearch };
