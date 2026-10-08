import { Text, View } from "react-native";
import { router } from "expo-router";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { currentBrief } from "../handoff-brief-store";
import { Markdown } from "../markdown";
import { CircleButton, PageScroll, colors, styles } from "../ui";

/** The brief the new provider was sent when a Chat switched providers, read-only, as desktop's brief dialog shows it. */
export default function HandoffBriefSheet() {
  const brief = currentBrief();
  return (
    <PageScroll style={styles.screen} contentContainerStyle={{ padding: 0, gap: 0, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
        <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: "600" }}>
          Handoff brief
        </Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Markdown text={brief} />
      </View>
    </PageScroll>
  );
}
