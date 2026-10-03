const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function socketPath(dataDir) {
  if (process.platform === 'win32') throw new Error('The local daemon currently supports macOS and Linux');
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('Pass an absolute --data-dir');
  const real = fs.realpathSync(dataDir);
  const digest = createHash('sha256').update(real).digest('hex').slice(0, 24);
  // Unix sockets have a short path limit; a userData path may exceed it on macOS.
  return path.join('/tmp', `milagre-${process.getuid()}`, `${digest}.sock`);
}
function prepareSocketDirectory(socket) {
  const directory = path.dirname(socket);
  fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`The daemon socket directory must be owned by you with mode 0700: ${directory}`);
  }
}
module.exports = { socketPath, prepareSocketDirectory };
