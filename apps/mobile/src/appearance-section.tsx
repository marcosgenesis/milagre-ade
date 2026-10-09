import { Platform, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { themes, themeSwatch, type ThemeChoice, type ThemeGroup } from "@milagre/shared/themes";
import { useTheme } from "./theme";
import { Segmented, useStyles } from "./ui";

const GROUPS: ThemeGroup[] = ["Milagre", "Catppuccin", "Popular"];
const MODES = [
  { value: "system", title: "System" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];

function Tile({ id, label, name, detail }: { id: ThemeChoice; label: string; name: string; detail: string }) {
  const { colors, settings, set } = useTheme();
  const styles = useStyles();
  const selected = settings.colorTheme === id;
  const { page, accent } = themeSwatch(id, settings.customTheme);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => {
        if (Platform.OS === "ios") void Haptics.selectionAsync().catch(() => {});
        set({ colorTheme: id });
      }}
      style={({ pressed }) => ({
        width: "48%",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 12,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.hover : colors.field,
        borderWidth: 2,
        borderColor: selected ? colors.accent : "transparent",
      })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, overflow: "hidden", backgroundColor: page, borderWidth: 1, borderColor: colors.line }}>
        <View style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, backgroundColor: accent }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.text, { fontSize: 14, fontWeight: "500", lineHeight: 18 }]}>
          {name}
        </Text>
        <Text numberOfLines={2} style={styles.caption}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

/** Settings › Appearance: the same modes and themes as desktop's Appearance page. */
export function AppearanceSection() {
  const styles = useStyles();
  const { settings, set } = useTheme();
  return (
    <View style={{ gap: 20 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Mode</Text>
        <Segmented label="Mode" value={settings.mode} options={MODES} onChange={(mode) => set({ mode: mode as typeof settings.mode })} />
      </View>
      {GROUPS.map((group) => (
        <View key={group} style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={group}>
          <Text style={styles.section}>{group}</Text>
          <View style={[styles.card, { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 0, rowGap: 8 }]}>
            {themes
              .filter((theme) => theme.group === group)
              .map((theme) => (
                <Tile
                  key={theme.id}
                  id={theme.id}
                  label={group === "Milagre" ? theme.name : `${group} ${theme.name}`}
                  name={theme.name}
                  detail={theme.id === "milagre-blue" ? "Default" : theme.id === "gray" ? "Classic" : `Light: ${theme.lightName}`}
                />
              ))}
            {group === "Milagre" && settings.customThemeEnabled && settings.customTheme ? (
              <Tile id="custom" label="Custom" name="Custom" detail="From Experimental" />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}
