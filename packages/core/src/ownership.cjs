const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// mkdir is the atomic ownership decision. Never infer that a missing/old PID makes
// it safe to steal a lock: crashes leave evidence for explicit operator recovery.
function acquireOwnership(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Milagre state is already owned. Close its other runtime. If it crashed, verify the process in ${path.join(lockPath, 'owner.json')} has exited before removing ${lockPath}.`);
  }
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  const file = path.join(lockPath, 'owner.json');
  try {
    fs.writeFileSync(file, JSON.stringify(owner, null, 2), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    release() {
      if (released) return;
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (current.token !== owner.token) throw new Error(`Milagre ownership changed: ${lockPath}`);
      fs.unlinkSync(file);
      fs.rmdirSync(lockPath);
      released = true;
    },
  };
}

module.exports = { acquireOwnership };
