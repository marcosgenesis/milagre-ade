const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { acquireOwnership } = require('./ownership.cjs');

test('atomic locks survive an unclean exit and are never silently stolen', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-owner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, 'runtime.lock');
  const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).acquireOwnership(process.argv[2]);', require.resolve('./ownership.cjs'), lockPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const before = fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8');
  assert.throws(() => acquireOwnership(lockPath), /already owned.*owner.json/s);
  assert.equal(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'), before);
});

test('release is idempotent and cannot remove a replacement ownership record', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-owner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, 'runtime.lock');
  const first = acquireOwnership(lockPath);
  first.release();
  const second = acquireOwnership(lockPath);
  first.release();
  assert.throws(() => acquireOwnership(lockPath), /already owned/);
  second.release();
  assert.equal(fs.existsSync(lockPath), false);
});
