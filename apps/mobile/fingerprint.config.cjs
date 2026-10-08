// The runtime version is this project's fingerprint. Build profiles (eas.json) and npm scripts don't change the native
// app, so they stay out of it; otherwise editing either would cut installed builds off from over-the-air updates.

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ["PackageJsonScriptsAll"],
  // Fingerprint always reads eas.json; hashing it as empty keeps the source without its content.
  fileHookTransform: (source, chunk) => (source.type === "file" && source.filePath === "eas.json" ? null : chunk),
};
