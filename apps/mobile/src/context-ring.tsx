import { Pressable } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ContextUsage } from "@milagre/shared/model";
import { contextSummary, contextTone } from "@milagre/shared/usage";
import { useTheme } from "./theme";

/** A ring that fills as the agent's context window does; the agent compacts it when it gets close to full. A tap opens the details. */
export function ContextRing({ onPress, ...usage }: ContextUsage & { onPress: () => void }) {
  const { colors } = useTheme();
  const { ratio, percent, tokens } = contextSummary(usage);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Context: ${percent}% used (${tokens})`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 34, height: 34, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Svg width={20} height={20} viewBox="0 0 20 20" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={10} cy={10} r={radius} fill="none" stroke={colors.lineStrong} strokeWidth={2.5} />
        <Circle
          cx={10}
          cy={10}
          r={radius}
          fill="none"
          stroke={{ normal: colors.ink2, warning: colors.accentInk, critical: colors.red }[contextTone(percent)]}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </Svg>
    </Pressable>
  );
}
