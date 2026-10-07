import { Text, View } from "react-native";
import type { DiffFileEntry } from "@milagre/shared/git-diff";
import { colors, fonts } from "./theme";

const STATUS = {
  added: { letter: "A", label: "Added", color: colors.green, tint: colors.greenTint },
  deleted: { letter: "D", label: "Deleted", color: colors.red, tint: colors.redTint },
  modified: { letter: "M", label: "Modified", color: colors.orange, tint: colors.orangeTint },
  renamed: { letter: "R", label: "Renamed", color: colors.accentInk, tint: colors.accentTint },
} as const;

/** Desktop's +N −M counts. */
export function Counts({ added, removed, size = 12 }: { added: number; removed: number; size?: number }) {
  return (
    <Text accessibilityLabel={`${added} added, ${removed} removed`} style={{ fontFamily: fonts.mono, fontSize: size, fontVariant: ["tabular-nums"] }}>
      <Text style={{ color: colors.green }}>+{added}</Text> <Text style={{ color: colors.red }}>−{removed}</Text>
    </Text>
  );
}

/** Desktop's A/D/M/R status box. */
export function StatusBox({ status }: { status: DiffFileEntry["status"] }) {
  const { letter, label, color, tint } = STATUS[status];
  return (
    <View
      accessibilityLabel={label}
      style={{ width: 18, height: 18, borderRadius: 5, borderCurve: "continuous", backgroundColor: tint, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color, fontFamily: fonts.mono, fontSize: 11, fontWeight: "700" }}>{letter}</Text>
    </View>
  );
}
