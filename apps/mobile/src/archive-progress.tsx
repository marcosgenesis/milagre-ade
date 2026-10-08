import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { archiveActivity, subscribeArchiveActivity } from "./archive";
import { LoadingLogo } from "./loading-logo";
import { colors, styles } from "./ui";

/** Which Chats are archiving and the last archive notice, kept across screens. */
export function useArchiveActivity() {
  return useSyncExternalStore(subscribeArchiveActivity, archiveActivity);
}

export function ArchiveProgress() {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Archiving Chat"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}
    >
      <LoadingLogo size={22} />
      <Text style={styles.muted}>Archiving...</Text>
    </View>
  );
}

/** Sits over a Chat's row while it archives; the row itself fades and takes no taps until the archive ends. */
export function ArchivingOverlay({ title }: { title: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Archiving ${title}`}
      accessibilityLiveRegion="polite"
      style={[StyleSheet.absoluteFill, s.overlay]}
    >
      <View style={s.pill}>
        <LoadingLogo size={16} />
        <Text style={s.label}>Archiving...</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { alignItems: "center", justifyContent: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: "500" },
});
