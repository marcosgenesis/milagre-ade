/** Picker order and the names used by every client and CLI notice. */
export const PROVIDERS = Object.freeze(["codex", "claude"]);
const names = { codex: { name: "Codex", cli: "Codex" }, claude: { name: "Claude", cli: "Claude Code" } };
export const providerName = (provider) => (names[provider] ?? names.claude).name;
export const cliName = (provider) => (names[provider] ?? names.claude).cli;
