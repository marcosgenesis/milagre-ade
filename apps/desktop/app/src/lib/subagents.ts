import type { Subagent } from "../model";

export { subagentFinished } from "@milagre/shared/project-edits";

export const subagentActive = (agent: Subagent) => ["initializing", "running", "waiting"].includes(agent.status);
