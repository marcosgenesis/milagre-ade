import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useIsStreaming, useTriggerAction } from "@milagre/shared/genui-renderer";
import type { ComponentRenderProps } from "@milagre/shared/genui-renderer";
import type { GenuiComponentName, GenuiProps } from "@milagre/shared/genui";
import { squareRows } from "@milagre/shared/genui";
import { useTheme } from "../theme";
import { Button as UiButton, PageScroll } from "../ui";
import { BarChart, LineChart } from "./charts";

export type GenuiRenderer<K extends GenuiComponentName> = (args: ComponentRenderProps<GenuiProps<K>>) => ReactNode;

const GAP = { s: 4, m: 8, l: 16 } as const;

const Stack: GenuiRenderer<"Stack"> = ({ props, renderNode }) => (
  <View
    style={{ flexDirection: props.direction === "row" ? "row" : "column", flexWrap: props.direction === "row" ? "wrap" : "nowrap", gap: GAP[props.gap ?? "m"] }}
  >
    {renderNode(props.children)}
  </View>
);

const Heading: GenuiRenderer<"Heading"> = ({ props }) => {
  const { colors } = useTheme();
  const level = props.level ?? 2;
  return (
    <Text
      style={{
        color: level === 3 ? colors.ink2 : colors.ink,
        fontSize: level === 1 ? 17 : level === 2 ? 16 : 15,
        fontWeight: level === 3 ? "500" : "600",
        lineHeight: 23,
      }}
    >
      {props.text}
    </Text>
  );
};

const TextBlock: GenuiRenderer<"Text"> = ({ props }) => {
  const { colors } = useTheme();
  const tone = props.tone ?? "default";
  return (
    <Text style={{ color: tone === "muted" ? colors.ink2 : colors.ink, fontWeight: tone === "strong" ? "500" : "400", fontSize: 15, lineHeight: 22 }}>
      {props.text}
    </Text>
  );
};

const KeyValue: GenuiRenderer<"KeyValue"> = ({ props }) => {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {props.pairs.map(([key, value], index) => (
        <View key={index} style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ color: colors.ink2, fontSize: 15, lineHeight: 22, minWidth: 96 }}>{key}</Text>
          <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, flex: 1 }}>{value}</Text>
        </View>
      ))}
    </View>
  );
};

const Table: GenuiRenderer<"Table"> = ({ props }) => {
  const { colors } = useTheme();
  const rows = squareRows(props.columns, props.rows);
  const widths = props.columns.map((column, index) =>
    Math.min(240, Math.max(80, ...[column, ...rows.map((row) => row[index] ?? "")].map((cell) => cell.length * 8 + 20))),
  );
  const cellStyle = { paddingHorizontal: 10, paddingVertical: 6, flexGrow: 1 } as const;
  return (
    <View
      style={{ borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" }}
    >
      <PageScroll horizontal contentContainerStyle={{ padding: 0, paddingBottom: 0, flexGrow: 1 }}>
        <View style={{ flexGrow: 1 }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line }}>
            {props.columns.map((column, index) => (
              <Text key={index} style={[cellStyle, { width: widths[index], color: colors.ink2, fontSize: 13, fontWeight: "500" }]}>
                {column}
              </Text>
            ))}
          </View>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: rowIndex < rows.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              {row.map((cell, cellIndex) => (
                <Text key={cellIndex} style={[cellStyle, { width: widths[cellIndex], color: colors.ink, fontSize: 14 }]}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </PageScroll>
    </View>
  );
};

const Callout: GenuiRenderer<"Callout"> = ({ props }) => {
  const { colors } = useTheme();
  const tone = props.tone ?? "info";
  const tint = { info: colors.accentTint, success: colors.greenTint, warning: colors.orangeTint, danger: colors.redTint }[tone];
  const edge = { info: colors.accent, success: colors.green, warning: colors.orange, danger: colors.red }[tone];
  return (
    <View
      style={{
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: edge,
        backgroundColor: tint,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 2,
      }}
    >
      {props.title && <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>{props.title}</Text>}
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{props.body}</Text>
    </View>
  );
};

const Progress: GenuiRenderer<"Progress"> = ({ props }) => {
  const { colors } = useTheme();
  const value = Math.min(1, Math.max(0, Number.isFinite(props.value) ? props.value : 0));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.ink2, fontSize: 13 }}>{props.label}</Text>
        <Text style={{ color: colors.ink2, fontSize: 13 }}>{Math.round(value * 100)}%</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.field, overflow: "hidden" }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.accent, width: `${value * 100}%` }} />
      </View>
    </View>
  );
};

const Button: GenuiRenderer<"Button"> = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  return (
    <UiButton
      title={props.label}
      secondary={props.variant === "secondary"}
      disabled={streaming}
      onPress={() => trigger(props.label, undefined, props.action as never)}
    />
  );
};

const flat =
  <K extends GenuiComponentName>(Component: (props: GenuiProps<K>) => ReactNode): GenuiRenderer<K> =>
  ({ props }) =>
    Component(props);

export const renderers: { [K in GenuiComponentName]: GenuiRenderer<K> } = {
  Stack,
  Heading,
  Text: TextBlock,
  KeyValue,
  Table,
  Callout,
  Progress,
  BarChart: flat<"BarChart">(BarChart),
  LineChart: flat<"LineChart">(LineChart),
  Button,
};
