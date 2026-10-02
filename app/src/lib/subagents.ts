import type { Subagent } from "../model";

export { subagentFinished } from "../../../electron/shared/project-edits.mjs";

export const subagentActive = (agent: Subagent) => ["initializing", "running", "waiting"].includes(agent.status);
