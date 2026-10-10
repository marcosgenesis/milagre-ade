import { Pressable, Text, View } from "react-native";
import { GitBranchIcon, Link04Icon } from "@hugeicons/core-free-icons";
import type { WorktreeLinkedContext } from "@milagre/shared/model";
import { linkedSummaryText, worktreeLinkLabel, worktreeLinkText } from "@milagre/shared/worktree-link";
import type { Client } from "./client";
import { Icon } from "./icons";
import { ProjectIcon } from "./project-icon";
import { fonts, useTheme } from "./theme";

/** A Link on the canvas that reached this Chat, as on desktop. Tapping it opens the linked summary the Chat's next turn gets. */
export function WorktreeLinkDivider({
  context,
  client,
  onOpen,
}: {
  context: WorktreeLinkedContext;
  client: Client | null;
  onOpen: (title: string, text: string) => void;
}) {
  const { colors } = useTheme();
  const label = worktreeLinkLabel(context);
  const summary = context.summary ? linkedSummaryText(context.summary) : undefined;
  return (
    <Pressable
      accessibilityRole={summary ? "button" : undefined}
      accessibilityLabel={worktreeLinkText(context)}
      accessibilityHint={summary ? "Opens the linked summary" : undefined}
      disabled={!summary}
      onPress={() => summary && onOpen("Linked summary", summary)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <View style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 5 }}>
        <Icon icon={Link04Icon} tone="ink3" size={13} />
        <Text style={{ color: colors.ink3, fontSize: 12 }}>Linked to{label.lead ? ` ${label.lead}` : ""}</Text>
        {label.project ? (
          <>
            <ProjectIcon client={client} path={context.project.path} size={13} />
            <Text style={{ color: colors.ink2, fontSize: 12, fontWeight: "500" }}>{label.project}</Text>
          </>
        ) : (
          <Icon icon={GitBranchIcon} tone="ink3" size={12} />
        )}
        {label.detail && (
          <Text style={{ color: label.project ? colors.ink3 : colors.ink2, fontSize: 11.5, fontFamily: fonts.mono, fontWeight: "500" }}>{label.detail}</Text>
        )}
        {context.sameProject && <Text style={{ color: colors.ink3, fontSize: 11 }}>in this Project</Text>}
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </Pressable>
  );
}
