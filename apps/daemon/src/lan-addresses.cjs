const os = require("node:os");

// Tunnels, VM bridges and Apple's peer-to-peer links: a phone on the Wi-Fi can't reach these.
const VIRTUAL = /^(utun|bridge|vmnet|awdl|llw|gif|stf|anpi|ap)\d*/;

function isPrivate(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The addresses a phone on the same network can dial. Numbers only: a name like `mac.local` can resolve to
 * another machine on another network, and the phone would hand it a hello.
 */
function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = new Set();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const entry of entries ?? []) {
      if ((entry.family === "IPv4" || entry.family === 4) && !entry.internal && isPrivate(entry.address)) found.add(entry.address);
    }
  }
  return [...found].toSorted((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

module.exports = { lanAddresses };
