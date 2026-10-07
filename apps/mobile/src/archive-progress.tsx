import { Text, View } from "react-native";
import { LoadingLogo } from "./loading-logo";
import { styles } from "./ui";

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
