const fs = require("node:fs");
const path = require("node:path");

// Agents need real filesystem paths to read a skill's references outside Electron.
const BUNDLED_SKILLS_DIRECTORY = path.join(__dirname, "bundled-skills").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");

function bundledWritingInstructions() {
  const directory = path.join(BUNDLED_SKILLS_DIRECTORY, "tldr");
  return [
    "Apply the bundled tldr writing rules by default to all user-facing progress updates and final replies. Apply both passes and the pre-send checklist before sending each message. This default is a writing preference, not an invocation to rewrite the previous message: do not announce activation or append a What changed list to ordinary replies. Keep user input, tool output, quotes and code intact. The user's explicit instructions take precedence over these defaults. If the user says stop tldr or normal mode, disable this default for the rest of the chat until they invoke /tldr again. Explicit /tldr requests use the modes below. The skill and checklist are included here so no file reads are needed for ordinary replies.",
    fs.readFileSync(path.join(directory, "SKILL.md"), "utf8"),
    fs.readFileSync(path.join(directory, "eval.md"), "utf8"),
  ].join("\n\n");
}

module.exports = { BUNDLED_SKILLS_DIRECTORY, bundledWritingInstructions };
