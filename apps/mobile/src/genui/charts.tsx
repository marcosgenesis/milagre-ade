import { Text, View } from "react-native";
import Svg, { Circle, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { GenuiProps } from "@milagre/shared/genui";
import { useTheme } from "../theme";

import { CHART_WIDTH as WIDTH, CHART_HEIGHT as HEIGHT, CHART_PAD as PAD, chartGeometry } from "@milagre/shared/genui";

function Labels({ labels, slot, color }: { labels: readonly string[]; slot: number; color: string }) {
  const every = Math.max(1, Math.ceil(40 / slot));
  return (
    <>
      {labels.map((label, index) =>
        index % every === 0 ? (
          <SvgText key={index} x={PAD.left + slot * index + slot / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={9} fill={color}>
            {label.length > 8 ? `${label.slice(0, 7)}…` : label}
          </SvgText>
        ) : null,
      )}
    </>
  );
}

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, gap: 6 }}
    >
      {title && <Text style={{ color: colors.ink2, fontSize: 13, fontWeight: "500" }}>{title}</Text>}
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {children}
      </Svg>
    </View>
  );
}

export function BarChart({ labels, values, title }: GenuiProps<"BarChart">) {
  const { colors } = useTheme();
  const { slot, y, zero } = chartGeometry(values);
  return (
    <Frame title={title}>
      {values.map((value, index) => (
        <Rect
          key={index}
          x={PAD.left + slot * index + slot * 0.15}
          y={Math.min(y(value), zero)}
          width={slot * 0.7}
          height={Math.max(1, Math.abs(zero - y(value)))}
          rx={2}
          fill={colors.accent}
        />
      ))}
      <Labels labels={labels.slice(0, values.length)} slot={slot} color={colors.ink3} />
    </Frame>
  );
}

export function LineChart({ labels, values, title }: GenuiProps<"LineChart">) {
  const { colors } = useTheme();
  const { slot, y } = chartGeometry(values);
  const points = values.map((value, index) => `${PAD.left + slot * index + slot / 2},${y(value)}`).join(" ");
  return (
    <Frame title={title}>
      <Polyline points={points} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinejoin="round" />
      {values.map((value, index) => (
        <Circle key={index} cx={PAD.left + slot * index + slot / 2} cy={y(value)} r={2.5} fill={colors.accent} />
      ))}
      <Labels labels={labels.slice(0, values.length)} slot={slot} color={colors.ink3} />
    </Frame>
  );
}
