const os = require('node:os');
const { execFileSync } = require('node:child_process');

function computerName({ platform = process.platform, run = execFileSync, hostname = os.hostname } = {}) {
  if (platform === 'darwin') {
    try {
      const name = String(run('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
      if (name) return name;
    } catch { /* fall back to the hostname */ }
  }
  return hostname().replace(/\.local$/i, '');
}

function pairingLink({ address, token, name, access }) {
  let url;
  try { url = new URL(address); } catch { throw new Error('The pairing address must be a URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The pairing address must use http or https.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new Error('The pairing token must be 64 hex characters.');
  if (access && (url.protocol !== 'https:' || !/^[a-f0-9]{32}\.access$/.test(access.id) || !/^[A-Za-z0-9_-]{32,128}$/.test(access.secret))) throw new Error('The Cloudflare access token needs an HTTPS address, an id ending in .access and its secret.');
  // The Access service token rides along so the phone can pass Cloudflare's edge.
  const cloudflare = access ? `&cfId=${encodeURIComponent(access.id)}&cfSecret=${encodeURIComponent(access.secret)}` : '';
  return `milagre://pair?address=${encodeURIComponent(address)}&token=${token}&name=${encodeURIComponent(name ?? '')}${cloudflare}`;
}

module.exports = { computerName, pairingLink };
