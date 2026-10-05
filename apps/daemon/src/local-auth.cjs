const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual, createHmac } = require('node:crypto');
const { preparePrivateDirectory, assertPrivate, windowsAcl } = require('@milagre/core/private-files');
const tokenPath = dataDir => path.join(dataDir, 'daemon-private', 'token');
function prepareToken(dataDir) {
  const file = tokenPath(dataDir);
  preparePrivateDirectory(path.dirname(file));
  if (!fs.existsSync(file)) {
    // Link a complete, protected file into place atomically. Concurrent launches
    // cannot overwrite a live token or observe a token between open and write.
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      if (process.platform === 'win32') windowsAcl(temporary, { mode: 'protect' });
      try { fs.linkSync(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  return readToken(dataDir);
}

function readToken(dataDir) {
  const file = tokenPath(dataDir);
  // The completed token is published after the daemon secures its directory.
  // Before publication, ENOENT tells bootstrap to retry, rather than treating
  // the directory's intermediate owner/ACL as a permanent security failure.
  assertPrivate(file);
  assertPrivate(path.dirname(file));
  const token = fs.readFileSync(file, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local daemon authentication token');
  return token;
}
function validToken(expected, supplied) {
  return typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
function authenticationProof(token, role, clientNonce, serverNonce) {
  return createHmac('sha256', token).update(`${role}:${clientNonce}:${serverNonce}`).digest('hex');
}
const authenticationNonce = () => randomBytes(32).toString('hex');
const validNonce = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
module.exports = { tokenPath, prepareToken, readToken, validToken, authenticationProof, authenticationNonce, validNonce };
