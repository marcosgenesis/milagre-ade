const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const script = path.join(__dirname, 'finalize-update-feeds.cjs');
const names = ['Milagre-1.2.3-arm64.zip','Milagre-1.2.3-x64.zip','Milagre-1.2.3-arm64.dmg','Milagre-1.2.3-x64.dmg'];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-feeds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of names) fs.writeFileSync(path.join(root, name), 'abc');
  const feed = { version: '1.2.3', files: names.map(url=>({url,sha512:'stale',size:1})), path:names[0],sha512:'stale' };
  const file = path.join(root,'latest-mac.yml');
  fs.writeFileSync(file,YAML.stringify(feed));
  return { root,feed,file,run:(...args)=>spawnSync(process.execPath,[script,'--tag','v1.2.3','--platform','macos','--artifacts',root,...args],{encoding:'utf8'}) };
}
test('refreshes feed hashes from final signed bytes including legacy top-level fields', t=>{
  const f=fixture(t);
  assert.equal(f.run().status,0);
  const result=YAML.parse(fs.readFileSync(f.file,'utf8'));
  const digest=createHash('sha512').update('abc').digest('base64');
  assert.equal(result.sha512,digest);
  assert.ok(result.files.every(file=>file.size===3 && file.sha512===digest));
  assert.equal(f.run('--check').status,0);
  fs.writeFileSync(path.join(f.root,names[0]),'tampered');
  const check=f.run('--check');
  assert.notEqual(check.status,0);
  assert.match(check.stderr,/checksum mismatch/);
});
test('rejects missing architecture, unexpected paths and wrong feed versions before writing',t=>{
  const f=fixture(t);
  for (const change of [feed=>feed.files.pop(),feed=>feed.files[0].url='../outside.zip',feed=>feed.version='9.9.9']) {
    const feed=structuredClone(f.feed);change(feed);const original=YAML.stringify(feed);fs.writeFileSync(f.file,original);
    assert.notEqual(f.run().status,0);
    assert.equal(fs.readFileSync(f.file,'utf8'),original);
  }
});
test('rejects empty assets and symlinks',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.root,names[0]),'');assert.notEqual(f.run().status,0);
  fs.unlinkSync(path.join(f.root,names[0]));fs.symlinkSync(path.join(f.root,names[1]),path.join(f.root,names[0]));
  assert.notEqual(f.run().status,0);
});
