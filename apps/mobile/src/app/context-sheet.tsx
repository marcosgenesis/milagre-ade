import { useEffect } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contextSummary } from "@milagre/shared/usage";
import { useSession } from "../session";
import { colors, styles } from "../ui";

/** Desktop's context card as a sheet: how full the Chat's context window is. Reads the live numbers, so it fills while a turn runs. */
export default function ContextSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const project = session.snapshot?.project;
  const chat = project && id ? project.state.sessions[Number(id)] : undefined;
  const usage = (project && chat ? session.snapshot?.runs.runs[`${project.path}#${id}`]?.contextUsage : undefined) ?? chat?.contextUsage;
  const missing = !usage || usage.size <= 0;
  // The Chat went away (another host, a reset session): nothing to show.
  useEffect(() => {
    if (missing) router.back();
  }, [missing]);
  if (missing) return null;
  const { percent, tokens, left } = contextSummary(usage);
  return (
    <View style={{ paddingTop: 28, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 4, gap: 16 }}>
      <Text accessibilityRole="header" style={styles.subtitle}>
        Context
      </Text>
      <View style={{ gap: 7 }}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Context usage"
          accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}% used, ${tokens}` }}
          style={{ height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: colors.lineStrong }}
        >
          <View style={{ width: `${percent}%`, height: "100%", borderRadius: 3, backgroundColor: colors.ink }} />
        </View>
        <View style={[styles.row, { justifyContent: "space-between", gap: 4 }]}>
          <Text selectable style={{ color: colors.ink, fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] }}>
            {percent}% used
          </Text>
          <Text selectable style={{ color: colors.ink2, fontSize: 14, fontVariant: ["tabular-nums"] }}>
            {tokens}
          </Text>
        </View>
      </View>
      <Text style={styles.muted}>{left}. The agent compacts the conversation when it gets close to full.</Text>
    </View>
  );
}
