// What a paired desktop may not call on this Mac: pairing and device management (it must not manage its own access),
// push registration (a phone's), stopping the daemon, and signing in to or out of Linear (the Mac's own account, done at this Mac). Everything else is allowed, so a new desktop method works
// remotely by default. The Unix socket, this Mac's own window, has no policy.
const DENIED_PREFIXES = Object.freeze(["phone:", "devices:", "push:"]);
const DENIED = new Set(["daemon:stop", "linear:connect", "linear:cancel", "linear:disconnect"]);

const peerPolicy = Object.freeze({
  denies: (method) => DENIED.has(method) || DENIED_PREFIXES.some((prefix) => method.startsWith(prefix)),
});

module.exports = { peerPolicy };
