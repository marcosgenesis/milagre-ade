import assert from "node:assert/strict";
import test from "node:test";
import { filterSkills, groupSkills, shadowedBy, shortenHome, skillBody, skillProviderLabel } from "./skill-catalog.ts";
import type { SkillOption } from "./model.ts";

const skill = (name: string, scope: SkillOption["scope"], provider: string, description = "Use this skill"): SkillOption => ({ name, description, scope, provider, path: `/p/${scope}/${provider}/${name}/SKILL.md` });
const skills = [
  skill("review", "workspace", "claude", "Review the diff"),
  skill("ship", "workspace", "agents", "Open a PR"),
  skill("notes", "user", "codex", "Write release notes"),
  skill("tldr", "bundled", "milagre", "Shorter replies"),
];

test("search matches name or description, case-insensitively", () => {
  const all = { scope: "all" as const, provider: "all" };
  assert.deepEqual(filterSkills(skills, { ...all, query: "REVIEW" }).map((item) => item.name), ["review"]);
  assert.deepEqual(filterSkills(skills, { ...all, query: " release " }).map((item) => item.name), ["notes"]);
  assert.equal(filterSkills(skills, { ...all, query: "" }).length, 4);
});

test("scope, provider and search narrow together", () => {
  assert.deepEqual(filterSkills(skills, { query: "", scope: "workspace", provider: "all" }).map((item) => item.name), ["review", "ship"]);
  assert.deepEqual(filterSkills(skills, { query: "", scope: "workspace", provider: "agents" }).map((item) => item.name), ["ship"]);
  assert.deepEqual(filterSkills(skills, { query: "review", scope: "workspace", provider: "agents" }), []);
  assert.deepEqual(filterSkills(skills, { query: "", scope: "user", provider: "claude" }), []);
});

test("groups follow Project, User, Built-in order and drop empty groups", () => {
  assert.deepEqual(groupSkills(skills).map((group) => [group.label, group.skills.length]), [["Project", 2], ["User", 1], ["Built-in", 1]]);
  assert.deepEqual(groupSkills(skills.filter((item) => item.scope === "user")).map((group) => group.label), ["User"]);
});

test("a winner lists only the skills it hides", () => {
  const winner = skills[0];
  const hidden = { ...skill("review", "user", "agents"), shadowedBy: winner.path };
  const other = { ...skill("ship", "user", "claude"), shadowedBy: skills[1].path };
  assert.deepEqual(shadowedBy([hidden, other], winner), [hidden]);
  assert.deepEqual(shadowedBy(undefined, winner), []);
});

test("home folders shorten to ~ and labels name the CLI", () => {
  assert.equal(shortenHome("/Users/ana/.claude/skills/x/SKILL.md"), "~/.claude/skills/x/SKILL.md");
  assert.equal(shortenHome("/home/ana/.codex/skills/x/SKILL.md"), "~/.codex/skills/x/SKILL.md");
  assert.equal(shortenHome("/opt/project/.agents/skills/x/SKILL.md"), "/opt/project/.agents/skills/x/SKILL.md");
  assert.equal(shortenHome("Cannot read /Users/ana/.claude/skills/x/SKILL.md: too large"), "Cannot read ~/.claude/skills/x/SKILL.md: too large");
  assert.equal(skillProviderLabel("claude"), "Claude");
  assert.equal(skillProviderLabel("milagre"), "Milagre");
});

test("the body drops only a leading frontmatter block", () => {
  assert.equal(skillBody("---\nname: x\ndescription: y\n---\n# Title\nText\n"), "# Title\nText");
  assert.equal(skillBody("# No frontmatter\n---\nrule"), "# No frontmatter\n---\nrule");
});
