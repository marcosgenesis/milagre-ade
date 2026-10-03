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

function pairingLink({ address, token, name }) {
  let url;
  try { url = new URL(address); } catch { throw new Error('The pairing address must be a URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The pairing address must use http or https.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new Error('The pairing token must be 64 hex characters.');
  return `milagre-local://pair?address=${encodeURIComponent(address)}&token=${token}&name=${encodeURIComponent(name ?? '')}`;
}

// Prints the scan-to-pair block. The QR and the link both carry the token.
function printPairing({ address, token, name = computerName(), qr = true, log = console.log, renderQr = (text, done) => require('qrcode-terminal').generate(text, { small: true }, done) }) {
  const link = pairingLink({ address, token, name });
  log('\nScan with the Milagre app to pair:');
  if (qr) renderQr(link, code => log(code));
  log(`Pairing link: ${link}`);
  log('Warning: this QR code and link grant access to your agents. Do not share or screenshot them.\n');
  return link;
}

module.exports = { computerName, pairingLink, printPairing };
