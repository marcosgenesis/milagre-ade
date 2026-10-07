import { Alert, Pressable } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ContextUsage } from "@milagre/shared/model";
import { colors } from "./ui";

const formatTokens = (tokens: number) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens));

/** A ring that fills as the agent's context window does; the agent compacts it when it gets close to full. */
export function ContextRing({ used, size }: ContextUsage) {
  const ratio = Math.min(1, used / size);
  const percent = Math.round(ratio * 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const detail = `${percent}% used (${formatTokens(used)} of ${formatTokens(size)} tokens)`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Context: ${detail}`}
      onPress={() => Alert.alert("Context", `${detail}. The agent compacts the conversation when it gets close to full.`)}
      hitSlop={6}
      style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={20} height={20} viewBox="0 0 20 20" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={10} cy={10} r={radius} fill="none" stroke={colors.lineStrong} strokeWidth={2.5} />
        <Circle
          cx={10}
          cy={10}
          r={radius}
          fill="none"
          stroke={percent >= 90 ? colors.red : percent >= 75 ? colors.accentInk : colors.ink2}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </Svg>
    </Pressable>
  );
}
