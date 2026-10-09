import type { SkillCatalog } from "@milagre/shared/model";
import { useSession } from "./session";
import { useRpc } from "./use-rpc";
import { useTheme } from "./theme";

/** The open Project's skill catalog, or the user's skills only when no Project is open. */
export function useSkillCatalog() {
  const { client, snapshot } = useSession();
  const projectPath = snapshot?.project.path ?? null;
  return { projectPath, ...useRpc<SkillCatalog>(client, "skills:list", [projectPath]), connected: !!client };
}

/** The small pill beside a skill's name. */
export function useSkillBadge() {
  const { colors } = useTheme();
  return {
    color: colors.ink2,
    fontSize: 11,
    fontWeight: "500",
    backgroundColor: colors.field,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
    overflow: "hidden",
  } as const;
}
export const overrides = (count: number) => `Overrides ${count} other${count === 1 ? "" : "s"}`;
