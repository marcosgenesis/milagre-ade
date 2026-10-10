// Used by NSIS in Electron's Node mode, with the installed daemon client. No GUI
// or daemon is started here. Failed saves/authentication must abort replacement.
const fs = require("node:fs");
const path = require("node:path");

async function stopInstalledHost({ dataDir, connect = require("@milagre/daemon/client").connect, exists = fs.existsSync, timeoutMs = 30000 }) {
  let client;
  try {
    client = await connect({ dataDir });
  } catch (error) {
    // An absent endpoint with a recorded owner is an unclean exit, not proof
    // that it is safe to replace files. Leave recovery to the existing app.
    if (["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(error.code) && !exists(path.join(dataDir, "runtime.lock"))) return;
    throw error;
  }
  let timer;
  let onClose;
  const stopped = new Promise((resolve, reject) => {
    onClose = resolve;
    client.once("close", onClose);
    timer = setTimeout(() => reject(new Error("Milagre's background host did not stop. Close it before changing the installation.")), timeoutMs);
  });
  try {
    await Promise.all([client.call("daemon:stop"), stopped]);
  } finally {
    clearTimeout(timer);
    client.off("close", onClose);
    client.close();
  }
}

if (require.main === module) {
  const [clientFile, dataDir, ...extra] = process.argv.slice(2);
  if (!clientFile || !dataDir || extra.length || !path.isAbsolute(clientFile) || !path.isAbsolute(dataDir)) {
    console.error("Pass the installed daemon client and profile as absolute paths");
    process.exitCode = 1;
  } else {
    stopInstalledHost({ dataDir, connect: require(clientFile).connect }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
module.exports = { stopInstalledHost };
