/** Picker order and the names used by every client and CLI notice. */
export const PROVIDERS = Object.freeze(["codex", "claude"]);
const names = { codex: { name: "Codex", cli: "Codex" }, claude: { name: "Claude", cli: "Claude Code" } };
export const providerName = (provider) => (names[provider] ?? names.claude).name;
export const cliName = (provider) => (names[provider] ?? names.claude).cli;

/** Public account categories shared by desktop and mobile. Unknown plans get no badge. */
export function accountType(plan) {
  const value = typeof plan === "string" ? plan.trim().toLowerCase() : "";
  if (["business", "enterprise", "self_serve_business", "self_serve_business_polite"].includes(value)) return "Business";
  if (value === "team") return "Team";
  if (["free", "plus", "pro", "max", "go", "personal"].includes(value)) return "Personal";
  return null;
}
