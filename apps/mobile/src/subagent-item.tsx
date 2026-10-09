import { Text } from "react-native";
import { AiBrainIcon } from "@hugeicons/core-free-icons";
import { subagentActivityLabel, subagentRoleLabel } from "@milagre/shared/agent-activity";
import type { Subagent } from "@milagre/shared/model";
import { ActivityItem } from "./activity-item";
import { useStyles } from "./ui";
import { useTheme } from "./theme";

/** Subagent data adapted to the same icon, shimmer and output surface used by tool activity. */
export function SubagentItem({ agent }: { agent: Subagent }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const state =
    agent.status === "initializing" || agent.status === "running"
      ? "running"
      : agent.status === "waiting"
        ? "waiting"
        : agent.status === "failed"
          ? "failed"
          : "idle";
  return (
    <ActivityItem title={agent.title} icon={AiBrainIcon} state={state} status={subagentActivityLabel(agent)} note={subagentRoleLabel(agent)} disclosureOnly>
      {!!agent.latestActivity && (
        <Text selectable style={styles.caption}>
          {agent.latestActivity}
        </Text>
      )}
      {agent.transcript.slice(-4).map((item) => (
        <Text
          key={item.id}
          selectable
          style={item.kind === "tool" ? [styles.code, { fontSize: 12, color: colors.ink2 }] : { color: colors.ink2, fontSize: 13, lineHeight: 18 }}
        >
          {item.text}
        </Text>
      ))}
    </ActivityItem>
  );
}
