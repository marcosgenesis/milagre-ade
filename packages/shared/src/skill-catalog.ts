import type { ShadowedSkill, SkillOption } from "./model.ts";

export type SkillScope = SkillOption["scope"];

/** The Settings groups, in order. A group with no skills is not shown. */
export const SKILL_SCOPES: Array<{ scope: SkillScope; label: string }> = [
  { scope: "workspace", label: "Project" },
  { scope: "user", label: "User" },
  { scope: "bundled", label: "Built-in" },
];

/** The CLI folders discovery reads (`.claude/skills`…), as filter choices. */
export const SKILL_PROVIDERS = [
  { provider: "claude", label: "Claude" },
  { provider: "codex", label: "Codex" },
  { provider: "agents", label: "Agents" },
  { provider: "gemini", label: "Gemini" },
];

export function skillProviderLabel(provider: string) {
  return SKILL_PROVIDERS.find((item) => item.provider === provider)?.label ?? (provider === "milagre" ? "Milagre" : provider);
}

export interface SkillFilter {
  query: string;
  scope: SkillScope | "all";
  provider: string;
}

/** Search matches name and description like the `/` menu; scope and provider ("all" for any) narrow it further. */
export function filterSkills<T extends SkillOption>(skills: T[], { query, scope, provider }: SkillFilter) {
  const needle = query.trim().toLowerCase();
  return skills.filter(
    (skill) =>
      (scope === "all" || skill.scope === scope) &&
      (provider === "all" || skill.provider === provider) &&
      `${skill.name} ${skill.description}`.toLowerCase().includes(needle),
  );
}

export function groupSkills<T extends SkillOption>(skills: T[]) {
  return SKILL_SCOPES.map((group) => ({ ...group, skills: skills.filter((skill) => skill.scope === group.scope) })).filter((group) => group.skills.length > 0);
}

/** The same-named skills a winner hides. */
export function shadowedBy(shadowed: ShadowedSkill[] | undefined, skill: SkillOption) {
  return (shadowed ?? []).filter((item) => item.shadowedBy === skill.path);
}

/** A SKILL.md without its frontmatter, which the page shows as the name and description instead. */
export function skillBody(content: string) {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
}

// ponytail: guesses the home folder from the path (macOS and Linux layouts); pass the real one if a host ever reports it.
// Also shortens the paths inside a discovery warning.
export function shortenHome(text: string) {
  return text.replace(/(^|\s)\/(?:Users|home)\/[^/\s]+(?=\/|\s|$)/g, "$1~");
}
