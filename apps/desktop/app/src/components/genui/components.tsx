import type { ReactNode } from "react";
import { useIsStreaming, useTriggerAction } from "@milagre/shared/genui-renderer";
import type { ComponentRenderProps } from "@milagre/shared/genui-renderer";
import { squareRows } from "@milagre/shared/genui";
import type { GenuiComponentName, GenuiProps } from "@milagre/shared/genui";
import { ScrollArea } from "../primitives/ScrollArea";
import { BarChart, LineChart } from "./charts";

export type GenuiRenderer<K extends GenuiComponentName> = (args: ComponentRenderProps<GenuiProps<K>>) => ReactNode;

const GAP = { s: "gap-1", m: "gap-2", l: "gap-4" } as const;

export const Stack: GenuiRenderer<"Stack"> = ({ props, renderNode }) => (
  <div data-slot="genui-stack" className={`flex ${props.direction === "row" ? "flex-row flex-wrap items-start" : "flex-col"} ${GAP[props.gap ?? "m"]}`}>
    {renderNode(props.children)}
  </div>
);

const HEADING = { 1: "text-[15px] font-semibold", 2: "text-[14px] font-semibold", 3: "text-[13px] font-medium text-ink-2" } as const;

export const Heading: GenuiRenderer<"Heading"> = ({ props }) => <div className={`${HEADING[props.level ?? 2]} text-ink`}>{props.text}</div>;

const TONE = { default: "text-ink", muted: "text-ink-2", strong: "font-medium text-ink" } as const;

export const Text: GenuiRenderer<"Text"> = ({ props }) => <p className={`m-0 text-[13px] leading-[1.55] ${TONE[props.tone ?? "default"]}`}>{props.text}</p>;

export const KeyValue: GenuiRenderer<"KeyValue"> = ({ props }) => (
  <dl data-slot="genui-keyvalue" className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
    {props.pairs.map(([key, value], index) => (
      <div key={index} className="contents">
        <dt className="text-ink-2">{key}</dt>
        <dd className="m-0 text-ink">{value}</dd>
      </div>
    ))}
  </dl>
);

export const Table: GenuiRenderer<"Table"> = ({ props }) => {
  const rows = squareRows(props.columns, props.rows);
  return (
    <ScrollArea data-slot="genui-table" className="my-1 max-w-full rounded-card border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {props.columns.map((column, index) => (
              <th key={index} className="border-b border-line px-3 py-1.5 text-left font-medium text-ink-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-1.5 text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
};

const CALLOUT = {
  info: "border-accent/30 bg-accent-tint text-ink",
  success: "border-green/30 bg-green-tint text-ink",
  warning: "border-orange/30 bg-orange-tint text-ink",
  danger: "border-red/30 bg-red-tint text-ink",
} as const;

export const Callout: GenuiRenderer<"Callout"> = ({ props }) => (
  <div data-slot="genui-callout" data-tone={props.tone ?? "info"} className={`rounded-card border px-3 py-2 text-[13px] ${CALLOUT[props.tone ?? "info"]}`}>
    {props.title && <div className="mb-0.5 font-medium">{props.title}</div>}
    <div>{props.body}</div>
  </div>
);

export const Progress: GenuiRenderer<"Progress"> = ({ props }) => {
  const value = Math.min(1, Math.max(0, Number.isFinite(props.value) ? props.value : 0));
  return (
    <div data-slot="genui-progress" className="text-[13px]">
      <div className="mb-1 flex justify-between text-ink-2">
        <span>{props.label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-field">
        <div className="h-full rounded-full bg-accent" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
};

export const Button: GenuiRenderer<"Button"> = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  const secondary = props.variant === "secondary";
  return (
    <button
      type="button"
      data-slot="genui-button"
      disabled={streaming}
      onClick={() => trigger(props.label, undefined, props.action as never)}
      className={`inline-flex self-start items-center rounded-control px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40 ${secondary ? "border border-line bg-surface text-ink" : "bg-ink text-surface"}`}
    >
      {props.label}
    </button>
  );
};

/** The chart components take flat props; wrap them so the renderer map has one shape. */
const flat =
  <K extends GenuiComponentName>(Component: (props: GenuiProps<K>) => ReactNode): GenuiRenderer<K> =>
  ({ props }) =>
    Component(props);

export const renderers: { [K in GenuiComponentName]: GenuiRenderer<K> } = {
  Stack,
  Heading,
  Text,
  KeyValue,
  Table,
  Callout,
  Progress,
  BarChart: flat<"BarChart">(BarChart),
  LineChart: flat<"LineChart">(LineChart),
  Button,
};
