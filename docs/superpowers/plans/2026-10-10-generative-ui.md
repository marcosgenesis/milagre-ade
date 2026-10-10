# Generative UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent's reply can carry an `openui` fenced block that desktop and phone render as themed native tables, metrics, callouts, charts and buttons; a button sends a user message back.

**Architecture:** A shared component contract (`packages/shared/src/genui.ts`: names, descriptions, Zod props, caps) is bound to React renderers on desktop and React Native renderers on the phone through `@openuidev/react-lang`. Each platform's markdown renderer hands an `openui` fence to a `GenerativeUI` component that wraps OpenUI's `Renderer`, falls back to the plain code block on any failure, and posts `@ToAssistant` actions through a provider that holds the chat's send function. A bundled skill teaches the agent the syntax and the signatures; a test keeps the skill and the contract in step.

**Tech Stack:** `@openuidev/react-lang` 0.3.x (its `react-native` export condition serves the phone), `@openuidev/lang-core` 0.3.x, `zod` 4, React 19, React Native 0.86 with `react-native-svg` (already linked), node:test, the Electron checks under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-10-10-generative-ui-design.md`

## Global Constraints

- Fence info string is `openui`, matched case-insensitively on its first word.
- Caps: 200 rows, 12 columns, 100 chart points, 64 KB of block text. Over a cap: code block.
- No `Query`, `Mutation`, `@OpenUrl` or `@Set` behaviour. Only `continue_conversation` actions send.
- Dependencies are pure JavaScript only (`zod`, `@openuidev/lang-core`, `@openuidev/react-lang`). No native module, no new config plugin: the phone must ship OTA. Do not start an EAS build.
- Every desktop change has its phone counterpart in the same task (AGENTS.md).
- Scroll containers go through `ScrollArea` on desktop and `PageScroll` on the phone (`docs/agents/ui.md`).
- Theme tokens only: Tailwind `bg-surface`, `border-line`, `text-ink-2`, `text-ink-3`, `bg-accent`, `bg-accent-tint`, `text-accent-ink`, `bg-green-tint`, `bg-orange-tint`, `bg-red-tint`, `rounded-card`, `rounded-control` on desktop; `useTheme().colors` on the phone.
- No Claude attribution in commits or the PR.
- Before the PR: `npm run typecheck`, `npm run lint`, `npm test -- --unit`, `npm test -- --only genui`, `npm run typecheck:mobile`.

## Review Focus

1. A fence that is still open while the reply streams: the UI must build line by line, never flash a code block, and buttons must stay disabled. Pinned in Task 3 (Electron check, streaming case).
2. A block with `root` missing or every line invalid after the reply finished: a code block, not a blank. Pinned in Task 3 (fallback case) and Task 5 (phone `onParseResult`).
3. A `Table` row longer or shorter than `columns`, and cells that are numbers: cells are cut or padded and rendered as text. Pinned in Task 1 (schema test) and Task 2 (renderer).
4. Two blocks in one reply, each with a button; a tap sends only that button's message once, even on a double tap, and a failed send re-enables the button. Pinned in Task 3 and Task 5.
5. A phone reading a reply over the relay with a 64 KB block: no crash, the cap renders a code block. Pinned in Task 1 (`genuiLimits.text`) and Task 5.

---

### Task 1: Shared contract, dependencies, tests

**Files:**
- Create: `packages/shared/src/genui.ts`
- Create: `packages/shared/src/genui.test.ts`
- Modify: `packages/shared/package.json` (files, exports, dependencies)
- Modify: `apps/desktop/package.json`, `apps/mobile/package.json` (dependencies)
- Modify: `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: `GENUI_FENCE`, `isGenuiFence(info: string | undefined): boolean`, `genuiLimits`, `GENUI_ROOT = "Stack"`, `GENUI_COMPONENTS` (ordered record `{ description: string; props: ZodObject }`), `GenuiComponentName`, `GenuiProps<K>`, `genuiDefinitions<C>(renderers: Record<GenuiComponentName, C>): { name; description; props; component: C }[]`, `GENUI_ACTION_TYPE = "continue_conversation"`.

- [ ] **Step 1: Add the dependencies**

```bash
npm install zod@^4.6.5 @openuidev/lang-core@^0.3.2 --workspace @milagre/shared
npm install @openuidev/react-lang@^0.3.2 --workspace milagre --workspace @milagre/mobile
```

Expected: `package-lock.json` changes; `node -e 'require("@openuidev/react-lang")'` prints nothing. If `npm install` for `@milagre/mobile` complains about peer `react-dom`, add `--legacy-peer-deps` for that workspace only (the phone never imports `react-dom`; the `react-native` export of the runtime does not need it).

- [ ] **Step 2: Expose the file from the shared package**

In `packages/shared/package.json`, add `"src/genui.ts"` to `files` (after `"src/artifact.ts"`) and this entry to `exports` (next to `"./artifact"`):

```json
"./genui": "./src/genui.ts",
```

- [ ] **Step 3: Write the failing tests**

`packages/shared/src/genui.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GENUI_COMPONENTS, GENUI_ROOT, genuiDefinitions, genuiLimits, isGenuiFence } from "./genui.ts";

test("the fence is matched by its first word, case-insensitively", () => {
  assert.equal(isGenuiFence("openui"), true);
  assert.equal(isGenuiFence("OpenUI title=Summary"), true);
  assert.equal(isGenuiFence("openui-lang"), false);
  assert.equal(isGenuiFence("ts"), false);
  assert.equal(isGenuiFence(undefined), false);
});

test("the root is a component of the contract and children come first in it", () => {
  assert.ok(GENUI_ROOT in GENUI_COMPONENTS);
  assert.deepEqual(Object.keys(GENUI_COMPONENTS[GENUI_ROOT].props.shape), ["children", "direction", "gap"]);
});

test("every component has a description written for the model and positional props", () => {
  for (const [name, component] of Object.entries(GENUI_COMPONENTS)) {
    assert.ok(component.description.length > 20, `${name} describes itself`);
    assert.ok(Object.keys(component.props.shape).length > 0, `${name} has props`);
  }
});

test("a table accepts string cells and refuses more rows than the cap", () => {
  const { props } = GENUI_COMPONENTS.Table;
  assert.ok(props.safeParse({ columns: ["PR", "CI"], rows: [["#1", "green"]] }).success);
  assert.equal(props.safeParse({ columns: ["PR"], rows: Array.from({ length: genuiLimits.rows + 1 }, () => ["x"]) }).success, false);
  assert.equal(props.safeParse({ columns: Array.from({ length: genuiLimits.columns + 1 }, (_, i) => `c${i}`), rows: [] }).success, false);
});

test("a chart refuses more points than the cap and a progress value stays a number", () => {
  assert.equal(GENUI_COMPONENTS.BarChart.props.safeParse({ labels: ["a"], values: Array.from({ length: genuiLimits.points + 1 }, () => 1) }).success, false);
  assert.ok(GENUI_COMPONENTS.LineChart.props.safeParse({ labels: ["a", "b"], values: [1, 2], title: "Runs" }).success);
  assert.ok(GENUI_COMPONENTS.Progress.props.safeParse({ label: "Done", value: 0.4 }).success);
  assert.equal(GENUI_COMPONENTS.Progress.props.safeParse({ label: "Done", value: "40%" }).success, false);
});

test("a button takes an action plan or a legacy action object", () => {
  const { props } = GENUI_COMPONENTS.Button;
  assert.ok(props.safeParse({ label: "Go", action: { steps: [{ type: "continue_conversation", message: "Go" }] } }).success);
  assert.ok(props.safeParse({ label: "Go", action: { type: "continue_conversation" } }).success);
  assert.ok(props.safeParse({ label: "Go", action: { steps: [] }, variant: "secondary" }).success);
});

test("definitions bind one renderer per component, in contract order", () => {
  const names = Object.keys(GENUI_COMPONENTS);
  const renderers = Object.fromEntries(names.map((name) => [name, `render:${name}`])) as Record<keyof typeof GENUI_COMPONENTS, string>;
  const definitions = genuiDefinitions(renderers);
  assert.deepEqual(
    definitions.map((d) => d.name),
    names,
  );
  assert.equal(definitions[0]!.component, "render:Stack");
  assert.equal(definitions[0]!.description, GENUI_COMPONENTS.Stack.description);
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --test packages/shared/src/genui.test.ts`
Expected: FAIL, "Cannot find module './genui.ts'".

- [ ] **Step 5: Write the contract**

`packages/shared/src/genui.ts`:

```ts
import { z } from "zod";
import { tagSchemaId } from "@openuidev/lang-core";

/** The fence info string that marks a block of OpenUI Lang in a reply. */
export const GENUI_FENCE = "openui";

/** Whether a fence's info string names a generative UI block: its first word is `openui`, in any case. */
export const isGenuiFence = (info: string | undefined): boolean => (info ?? "").trim().split(/\s+/)[0]?.toLowerCase() === GENUI_FENCE;

/** Caps a block renders under; above any of them the block shows as code. */
export const genuiLimits = { rows: 200, columns: 12, points: 100, text: 64 * 1024 } as const;

/** The root component the agent assigns to `root`. */
export const GENUI_ROOT = "Stack";

/** The action type a button posts back to the chat (`@ToAssistant`); every other type is ignored. */
export const GENUI_ACTION_TYPE = "continue_conversation";

// An `Action([...])` evaluates to a plan of steps; the two object forms are the language's legacy action values.
const action = z.union([
  z.object({ steps: z.array(z.any()) }),
  z.object({ type: z.literal("continue_conversation"), context: z.string().optional() }),
  z.object({ type: z.string(), params: z.record(z.string(), z.any()).optional() }),
]);
tagSchemaId(action, "ActionExpression");

const cell = z.string().max(2000);
const label = z.string().max(200);

/**
 * The components an agent can use, in the order the skill lists them. Prop order is positional order in OpenUI Lang:
 * `Table(columns, rows)`. Descriptions are read by the model, so they say what each prop means.
 */
export const GENUI_COMPONENTS = {
  Stack: {
    description: "Lays out children vertically (default) or in a row. The root of every block.",
    props: z.object({
      children: z.array(z.any()).describe("Child components"),
      direction: z.enum(["column", "row"]).optional().describe('"column" (default) or "row"'),
      gap: z.enum(["s", "m", "l"]).optional().describe("Space between children, default m"),
    }),
  },
  Heading: {
    description: "A section title.",
    props: z.object({
      text: label.describe("Title text"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("1 largest, 3 smallest; default 2"),
    }),
  },
  Text: {
    description: "A paragraph of plain text, no markdown.",
    props: z.object({
      text: z.string().max(4000).describe("The text"),
      tone: z.enum(["default", "muted", "strong"]).optional().describe("muted for secondary text, strong for emphasis"),
    }),
  },
  KeyValue: {
    description: "Labels and values in two columns: metrics, counts, dates.",
    props: z.object({
      pairs: z.array(z.tuple([label, cell])).max(genuiLimits.rows).describe('[["label", "value"], ...]'),
    }),
  },
  Table: {
    description: "A table of string cells. Use for lists of results with several attributes each.",
    props: z.object({
      columns: z.array(label).min(1).max(genuiLimits.columns).describe("Column headers"),
      rows: z.array(z.array(cell).max(genuiLimits.columns)).max(genuiLimits.rows).describe("Rows of cells, one string per column"),
    }),
  },
  Callout: {
    description: "A highlighted note: a warning, a success, an error or a tip.",
    props: z.object({
      body: z.string().max(4000).describe("The note"),
      tone: z.enum(["info", "success", "warning", "danger"]).optional().describe("info (default), success, warning or danger"),
      title: label.optional().describe("Optional short title"),
    }),
  },
  Progress: {
    description: "A labelled progress bar.",
    props: z.object({
      label: label.describe("What is progressing"),
      value: z.number().describe("0 to 1"),
    }),
  },
  BarChart: {
    description: "Vertical bars, one series.",
    props: z.object({
      labels: z.array(label).max(genuiLimits.points).describe("One label per bar"),
      values: z.array(z.number()).max(genuiLimits.points).describe("One number per bar"),
      title: label.optional().describe("Optional chart title"),
    }),
  },
  LineChart: {
    description: "A line over ordered points, one series.",
    props: z.object({
      labels: z.array(label).max(genuiLimits.points).describe("One label per point"),
      values: z.array(z.number()).max(genuiLimits.points).describe("One number per point"),
      title: label.optional().describe("Optional chart title"),
    }),
  },
  Button: {
    description: 'A button that sends a message to the assistant when tapped: Button("Approve", Action([@ToAssistant("Approve the plan")])).',
    props: z.object({
      label: label.describe("Button text"),
      action: action.describe("Action([@ToAssistant(\"message\")]); only @ToAssistant steps act"),
      variant: z.enum(["primary", "secondary"]).optional().describe("primary (default) or secondary"),
    }),
  },
} as const;

export type GenuiComponentName = keyof typeof GENUI_COMPONENTS;
export type GenuiProps<K extends GenuiComponentName> = z.infer<(typeof GENUI_COMPONENTS)[K]["props"]>;

/** One `defineComponent` config per component, in contract order, bound to a platform's renderers. */
export function genuiDefinitions<C>(renderers: Record<GenuiComponentName, C>) {
  return (Object.keys(GENUI_COMPONENTS) as GenuiComponentName[]).map((name) => ({
    name,
    description: GENUI_COMPONENTS[name].description,
    props: GENUI_COMPONENTS[name].props,
    component: renderers[name],
  }));
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test packages/shared/src/genui.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. If the shared `tsc` does not see `genui.ts` (its tsconfig lists files explicitly), that is expected; the apps typecheck it when they import it in Tasks 2 and 4.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/genui.ts packages/shared/src/genui.test.ts packages/shared/package.json apps/desktop/package.json apps/mobile/package.json package-lock.json
git commit -m "feat(genui): shared component contract for OpenUI Lang blocks"
```

---

### Task 2: Desktop renderers and library

**Files:**
- Create: `apps/desktop/app/src/components/genui/components.tsx`
- Create: `apps/desktop/app/src/components/genui/charts.tsx`
- Create: `apps/desktop/app/src/components/genui/library.ts`
- Create: `apps/desktop/app/src/lib/genui-table.ts`
- Create: `apps/desktop/app/src/lib/genui-table.test.ts`

**Interfaces:**
- Consumes: `GENUI_COMPONENTS`, `GENUI_ROOT`, `GenuiProps`, `genuiDefinitions` from `@milagre/shared/genui`; `defineComponent`, `createLibrary`, `useTriggerAction`, `useIsStreaming`, `ComponentRenderProps` from `@openuidev/react-lang`.
- Produces: `genuiLibrary` (a `Library` for `Renderer`), `squareRows(columns, rows)` in `lib/genui-table.ts`, `chartGeometry(values, width, height)` in `charts.tsx`.

- [ ] **Step 1: Write the failing table test**

`apps/desktop/app/src/lib/genui-table.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { squareRows } from "./genui-table.ts";

test("rows are cut or padded to the columns and cells become strings", () => {
  assert.deepEqual(squareRows(["a", "b"], [["1"], ["1", "2", "3"], [4, null as unknown as string]]), [
    ["1", ""],
    ["1", "2"],
    ["4", ""],
  ]);
});

test("no columns means no cells", () => {
  assert.deepEqual(squareRows([], [["x"]]), [[]]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test apps/desktop/app/src/lib/genui-table.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the helper**

`apps/desktop/app/src/lib/genui-table.ts`:

```ts
/** Every row gets exactly one string per column: longer rows are cut, shorter ones padded, non-strings printed. */
export function squareRows(columns: readonly string[], rows: readonly (readonly unknown[])[]): string[][] {
  return rows.map((row) => columns.map((_, index) => (row[index] === undefined || row[index] === null ? "" : String(row[index]))));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test apps/desktop/app/src/lib/genui-table.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the charts**

`apps/desktop/app/src/components/genui/charts.tsx`:

```tsx
import type { GenuiProps } from "@milagre/shared/genui";

const WIDTH = 320;
const HEIGHT = 140;
const PAD = { top: 8, right: 8, bottom: 22, left: 8 };

/** Where each value sits on a WIDTH by HEIGHT canvas; a flat series sits on the baseline. */
export function chartGeometry(values: readonly number[], width = WIDTH, height = HEIGHT) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const inner = { width: width - PAD.left - PAD.right, height: height - PAD.top - PAD.bottom };
  const slot = values.length ? inner.width / values.length : inner.width;
  const y = (value: number) => PAD.top + inner.height - ((value - min) / span) * inner.height;
  return { slot, y, zero: y(0), inner };
}

function Labels({ labels, slot }: { labels: readonly string[]; slot: number }) {
  // Only as many labels as fit at about 40px each; the rest stay in the tooltip of their bar or point.
  const every = Math.max(1, Math.ceil(40 / slot));
  return (
    <>
      {labels.map((label, index) =>
        index % every === 0 ? (
          <text key={index} x={PAD.left + slot * index + slot / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-ink-3 text-[9px]">
            {label.length > 8 ? `${label.slice(0, 7)}…` : label}
          </text>
        ) : null,
      )}
    </>
  );
}

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <figure data-slot="genui-chart" className="my-1 rounded-card border border-line bg-surface p-3">
      {title && <figcaption className="mb-1 text-[12px] font-medium text-ink-2">{title}</figcaption>}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full max-w-md" role="img" aria-label={title ?? "chart"}>
        {children}
      </svg>
    </figure>
  );
}

export function BarChart({ labels, values, title }: GenuiProps<"BarChart">) {
  const { slot, y, zero } = chartGeometry(values);
  return (
    <Frame title={title}>
      {values.map((value, index) => {
        const top = Math.min(y(value), zero);
        return (
          <rect key={index} x={PAD.left + slot * index + slot * 0.15} y={top} width={slot * 0.7} height={Math.max(1, Math.abs(zero - y(value)))} rx={2} className="fill-accent">
            <title>{`${labels[index] ?? ""}: ${value}`}</title>
          </rect>
        );
      })}
      <Labels labels={labels} slot={slot} />
    </Frame>
  );
}

export function LineChart({ labels, values, title }: GenuiProps<"LineChart">) {
  const { slot, y } = chartGeometry(values);
  const points = values.map((value, index) => `${PAD.left + slot * index + slot / 2},${y(value)}`).join(" ");
  return (
    <Frame title={title}>
      <polyline points={points} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-accent" />
      {values.map((value, index) => (
        <circle key={index} cx={PAD.left + slot * index + slot / 2} cy={y(value)} r={2.5} className="fill-accent">
          <title>{`${labels[index] ?? ""}: ${value}`}</title>
        </circle>
      ))}
      <Labels labels={labels} slot={slot} />
    </Frame>
  );
}
```

- [ ] **Step 6: Write the components**

`apps/desktop/app/src/components/genui/components.tsx`:

```tsx
import type { ReactNode } from "react";
import { useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { GenuiComponentName, GenuiProps } from "@milagre/shared/genui";
import { squareRows } from "../../lib/genui-table";
import { ScrollArea } from "../primitives/ScrollArea";
import { BarChart, LineChart } from "./charts";

export type GenuiRenderer<K extends GenuiComponentName> = (args: ComponentRenderProps<GenuiProps<K>, ReactNode>) => ReactNode;

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
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-line px-3 py-1.5 text-ink last:border-b-0">
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
      className={`inline-flex items-center rounded-control px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40 ${secondary ? "border border-line bg-surface text-ink" : "bg-ink text-surface"}`}
    >
      {props.label}
    </button>
  );
};

export const renderers = { Stack, Heading, Text, KeyValue, Table, Callout, Progress, BarChart, LineChart, Button };
```

`BarChart` and `LineChart` take flat props in `charts.tsx`; wrap them so the map has one shape. Add at the end of `components.tsx`, replacing the last line:

```tsx
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
```

If `ScrollArea` does not accept `data-slot`, wrap it: `<div data-slot="genui-table"><ScrollArea ...>`. Check `apps/desktop/app/src/components/primitives/ScrollArea.tsx` for its props first.

- [ ] **Step 7: Build the library**

`apps/desktop/app/src/components/genui/library.ts`:

```ts
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { GENUI_ROOT, genuiDefinitions } from "@milagre/shared/genui";
import { renderers } from "./components";

/** The contract bound to the desktop renderers; what `Renderer` draws a block with. */
export const genuiLibrary = createLibrary({
  root: GENUI_ROOT,
  components: genuiDefinitions(renderers).map((definition) => defineComponent(definition as Parameters<typeof defineComponent>[0])),
});
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck --workspace milagre`
Expected: clean. If `defineComponent`'s generic rejects the cast, type `renderers` as `Record<GenuiComponentName, GenuiRenderer<never>>` in the map call instead; the runtime shape is what matters.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/app/src/components/genui apps/desktop/app/src/lib/genui-table.ts apps/desktop/app/src/lib/genui-table.test.ts
git commit -m "feat(genui): desktop renderers and library"
```

---

### Task 3: Desktop block rendering, postback, Electron check

**Files:**
- Create: `apps/desktop/app/src/components/genui/GenerativeUI.tsx`
- Modify: `apps/desktop/app/src/components/markdown/Markdown.tsx:113-118` (pre handler) and `:161-170` (StreamingMarkdown)
- Modify: `apps/desktop/app/src/components/ChatComposer.tsx:841` and `:1043` (provider)
- Create: `scripts/test-genui.cjs`
- Modify: `scripts/test-runner.cjs:12-14` (MANIFEST)

**Interfaces:**
- Consumes: `genuiLibrary` (Task 2); `isGenuiFence`, `genuiLimits`, `GENUI_ACTION_TYPE` from `@milagre/shared/genui`; `Renderer` from `@openuidev/react-lang`; `CodeBlock`.
- Produces: `GenerativeUI({ code, fallback })`, `GenerativeUIProvider({ onSend, children })`, `MarkdownStreamingContext` (all exported from `GenerativeUI.tsx`).

- [ ] **Step 1: Write the Electron check (the failing test)**

`scripts/test-genui.cjs`. Copy the harness shape of `scripts/test-artifacts.cjs` (Vite fixture plugin, `browserChecks`, `screenshot`, `waitFor`, `main`). The fixture:

```js
// Run with node scripts/test-genui.cjs. Checks that an `openui` fence in a reply renders as native UI inside the
// answer, that a button in it sends its message once as the next user message, that a broken block falls back to
// a code block, and that an open fence while the reply streams builds up with its buttons disabled.
// Set MILAGRE_SCREENSHOT_DIR to keep screenshots.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const block = `\`\`\`openui
root = Stack([title, summary, prs, note, done, bars, actions])
title = Heading("Three PRs are waiting on you")
summary = KeyValue([["Open", "3"], ["Failing CI", "1"], ["Oldest", "4 days"]])
prs = Table(["PR", "Author", "CI"], [["#403 Worktree link line", "victor", "green"], ["#390 Sidebar Links", "victor", "red"], ["#377 Issue sheet font", "victor"]])
note = Callout("#390 needs a rebase before its CI can pass.", "warning", "One is red")
done = Progress("Review", 0.66)
bars = BarChart(["Mon", "Tue", "Wed"], [3, 5, 2], "PRs opened")
actions = Stack([approve, later], "row")
approve = Button("Merge the green ones", Action([@ToAssistant("Merge the PRs whose CI is green")]))
later = Button("Later", Action([@ToAssistant("Not now")]), "secondary")
\`\`\``;
const broken = "```openui\nnothing = Heading(\"No root here\")\n```";
const partial = "Here is the summary so far.\n\n```openui\nroot = Stack([title, approve])\ntitle = Heading(\"Streaming\")\napprove = Button(\"Go\", Action([@ToAssistant(\"Go\")]))\n";

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
window.sent = [];
window.failNext = false;
function Fixture() {
  const [said, setSaid] = useState([]);
  const [streaming, setStreaming] = useState(false);
  window.setStreaming = setStreaming;
  const onSendDesignMessage = async (text) => {
    if (window.failNext) { window.failNext = false; return false; }
    window.sent.push(text); setSaid((current) => [...current, text]); return true;
  };
  const messages = [
    { id: 1, session_id: 1, context: null, role: "user", body: "what's waiting on me?" },
    { id: 2, session_id: 1, context: null, role: "assistant", body: "Three PRs.\\n\\n" + ${JSON.stringify(block)} + "\\n\\nAnd a block that is not valid:\\n\\n" + ${JSON.stringify(broken)}, steps: [] },
    ...said.map((body, index) => ({ id: 10 + index, session_id: 1, context: null, role: "user", body })),
  ];
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages} onSendDesignMessage={onSendDesignMessage}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" messageScope="/fixture" agentChatId="/fixture#1" draft="" onDraftChange={noop} onSend={noop} isSending={streaming} sendBlocked={false}
      streamingText={streaming ? ${JSON.stringify(partial)} : ""} asking={false}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={MODEL_CATALOG[0]} onModelChange={noop}
      capability={capabilityFor(MODEL_CATALOG[0], null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;
```

Check `ChatComposer`'s props in `ChatComposer.tsx:425-470` before running: if the streaming reply is given through a different prop than `streamingText` (search for `streamingText` and `streamingSteps` in the file), use that one. The checks, inside `browserChecks` after `loadURL`:

```js
    const blocks = 'document.querySelectorAll("[data-slot=genui]")';
    const buttons = `${blocks}[0].querySelectorAll("[data-slot=genui-button]")`;
    await waitFor(`${blocks}.length === 1 && ${blocks}[0].querySelectorAll("[data-slot=genui-table] tbody tr").length === 3`);
    // The block is inside the answer, not folded into the activity, and every component drew.
    assert.equal(await evaluate(`!!${blocks}[0].closest("[data-slot=message-content]")`), true);
    const text = await evaluate(`${blocks}[0].textContent`);
    for (const expected of ["Three PRs are waiting on you", "Failing CI", "#403 Worktree link line", "One is red", "Review", "66%", "PRs opened"]) assert.match(text, new RegExp(expected));
    // A short row is padded: the third row has three cells, the last one empty.
    assert.deepEqual(await evaluate(`[...${blocks}[0].querySelectorAll("tbody tr")[2].cells].map((c) => c.textContent)`), ["#377 Issue sheet font", "victor", ""]);
    assert.equal(await evaluate(`${blocks}[0].querySelectorAll("[data-slot=genui-chart] rect").length`), 3);
    // The broken block is a code block, with its text intact.
    assert.match(await evaluate('[...document.querySelectorAll("pre")].map((p) => p.textContent).join("|")'), /nothing = Heading/);
    await evaluate(`${blocks}[0].scrollIntoView()`);
    await screenshot("block");

    // A tap sends the button's message once, as the next user message; a double tap does not send twice.
    await evaluate(`${buttons}[0].click(); ${buttons}[0].click()`);
    await waitFor('window.sent.length >= 1');
    await delay(300);
    assert.deepEqual(await evaluate("window.sent"), ["Merge the PRs whose CI is green"]);
    await waitFor('[...document.querySelectorAll("[data-slot=message-content], [data-slot=user-message], p")].some((n) => n.textContent.includes("Merge the PRs whose CI is green"))');
    await screenshot("sent");
    // A failed send re-enables the button; the next tap goes through.
    await evaluate("window.failNext = true");
    await evaluate(`${buttons}[1].click()`);
    await delay(300);
    assert.equal(await evaluate(`${buttons}[1].disabled`), false);
    await evaluate(`${buttons}[1].click()`);
    await waitFor("window.sent.length === 2");
    assert.deepEqual(await evaluate("window.sent"), ["Merge the PRs whose CI is green", "Not now"]);

    // While the reply streams, an open fence builds up as UI with its buttons disabled, never as a code block.
    await evaluate("window.setStreaming(true)");
    await waitFor(`${blocks}.length === 2 && ${blocks}[1].textContent.includes("Streaming")`);
    assert.equal(await evaluate(`${blocks}[1].querySelector("[data-slot=genui-button]").disabled`), true);
    assert.equal(await evaluate(`${blocks}[1].querySelector("pre")`), null);
    await evaluate(`${blocks}[1].scrollIntoView()`);
    await screenshot("streaming");
    await evaluate("window.setStreaming(false)");
```

Register the check in `scripts/test-runner.cjs` MANIFEST, after `"test-artifacts.cjs"`:

```js
  "test-genui.cjs": { seconds: 20 },
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- --only genui`
Expected: FAIL at the first `waitFor` ("Timed out"), because no `[data-slot=genui]` exists yet.

- [ ] **Step 3: Write `GenerativeUI` and its provider**

`apps/desktop/app/src/components/genui/GenerativeUI.tsx`:

```tsx
import { Component, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent, ParseResult } from "@openuidev/react-lang";
import { GENUI_ACTION_TYPE, genuiLimits } from "@milagre/shared/genui";
import { genuiLibrary } from "./library";

type Send = (text: string) => Promise<boolean>;
const SendContext = createContext<{ onSend?: Send }>({});

/** Gives every block in the transcript the chat's send function, so a button can post its message. */
export function GenerativeUIProvider({ onSend, children }: { onSend?: Send; children: ReactNode }) {
  const value = useMemo(() => ({ onSend }), [onSend]);
  return <SendContext value={value}>{children}</SendContext>;
}

/** Whether the surrounding markdown is the block of a reply still being written. */
export const MarkdownStreamingContext = createContext(false);

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * An `openui` fence rendered from the component contract. `fallback` is the plain code block, shown when the text is
 * over the cap, parses to no root once the reply has finished, or a renderer throws.
 */
export function GenerativeUI({ code, fallback }: { code: string; fallback: ReactNode }) {
  const streaming = useContext(MarkdownStreamingContext);
  const { onSend } = useContext(SendContext);
  const [rootless, setRootless] = useState(false);
  const [busy, setBusy] = useState(false);
  // A second tap while the first send is in flight must not send again; state alone is stale within the same tick.
  const sending = useRef(false);
  const onParseResult = useCallback((result: ParseResult | null) => setRootless(!result?.root), []);
  const onAction = useCallback(
    async (event: ActionEvent) => {
      if (event.type !== GENUI_ACTION_TYPE || !onSend || sending.current || !event.humanFriendlyMessage) return;
      sending.current = true;
      setBusy(true);
      try {
        await onSend(event.humanFriendlyMessage);
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [onSend],
  );
  if (code.length > genuiLimits.text) return <>{fallback}</>;
  const empty = rootless && !streaming;
  return (
    <Boundary fallback={fallback}>
      {empty && fallback}
      <div data-slot="genui" hidden={empty} className={`my-2 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Renderer response={code} library={genuiLibrary} isStreaming={streaming} onParseResult={onParseResult} onAction={onAction} />
      </div>
    </Boundary>
  );
}
```

The `Renderer` stays mounted behind the fallback so `onParseResult` can flip `rootless` back if a later version of the text gains a root.

- [ ] **Step 4: Hook the fence in `Markdown.tsx`**

In `apps/desktop/app/src/components/markdown/Markdown.tsx`, import at the top:

```tsx
import { isGenuiFence } from "@milagre/shared/genui";
import { GenerativeUI, MarkdownStreamingContext } from "../genui/GenerativeUI";
```

Replace the `pre` handler (lines 114-118):

```tsx
  pre({ children }) {
    const code = Children.toArray(children).find(isValidElement) as { props: { className?: string; children?: ReactNode } } | undefined;
    const text = String(code?.props.children ?? "").replace(/\n$/, "");
    const fence = codeLanguageFromClassName(code?.props.className);
    const plain = <CodeBlock code={text} fence={fence} />;
    return isGenuiFence(fence) ? <GenerativeUI code={text} fallback={plain} /> : plain;
  },
```

In `StreamingMarkdown`, wrap the last block so blocks inside it know the reply is still being written:

```tsx
      {blocks.map((block, index) =>
        index === blocks.length - 1 ? (
          <MarkdownStreamingContext key={index} value={true}>
            <MarkdownBody text={closeOpenMarkdown(block)} />
          </MarkdownStreamingContext>
        ) : (
          <MarkdownBody key={index} text={block} />
        ),
      )}
```

Check `codeLanguageFromClassName` in `apps/desktop/app/src/lib/code-languages.ts:58`: it must return the raw fence word (`openui`), not only known languages. If it maps unknown names to `undefined`, read the class name directly: `const fence = /language-(\S+)/.exec(code?.props.className ?? "")?.[1]`.

- [ ] **Step 5: Wrap the transcript in the provider**

In `apps/desktop/app/src/components/ChatComposer.tsx`, import `GenerativeUIProvider` from `./genui/GenerativeUI`, and change line 841 and its closing tag at 1043:

```tsx
    <ArtifactsProvider chatId={artifactChat} steps={artifactSteps} userMessages={userMessages} onSend={onSendDesignMessage}>
      <GenerativeUIProvider onSend={onSendDesignMessage}>
        ...existing children unchanged...
      </GenerativeUIProvider>
    </ArtifactsProvider>
```

`onSendDesignMessage` is `App.tsx:2305`'s `executeSend(text, permissionMode, [], [], true)`: a plain user message through the normal send path, which is what a button needs.

- [ ] **Step 6: Run the check to see it pass**

Run: `MILAGRE_SCREENSHOT_DIR=$TMPDIR/genui npm test -- --only genui`
Expected: PASS; `$TMPDIR/genui/block.png`, `sent.png`, `streaming.png` exist. Open `block.png` and confirm the table, callout, progress bar and chart use the dark theme tokens (no white backgrounds).

If the Renderer renders nothing: check the console for `ToolNotFoundError` or a schema error, and confirm `genuiLibrary` lists ten components (`genuiLibrary.toJSONSchema()` in the fixture's console).

- [ ] **Step 7: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm test -- --unit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/app/src/components/genui/GenerativeUI.tsx apps/desktop/app/src/components/markdown/Markdown.tsx apps/desktop/app/src/components/ChatComposer.tsx scripts/test-genui.cjs scripts/test-runner.cjs
git commit -m "feat(genui): render openui blocks inline on desktop, buttons post back"
```

---

### Task 4: Phone renderers and library

**Files:**
- Create: `apps/mobile/src/genui/components.tsx`
- Create: `apps/mobile/src/genui/charts.tsx`
- Create: `apps/mobile/src/genui/library.ts`
- Create: `apps/mobile/src/genui-table.ts` (same helper as desktop; `apps/mobile/src/*.test.ts` is the phone's unit test glob)
- Create: `apps/mobile/src/genui-table.test.ts`

**Interfaces:**
- Consumes: the shared contract (Task 1); `Button`, `PageScroll` from `../ui`; `useTheme` from `../theme`; `Svg, Rect, Polyline, Circle, Text as SvgText` from `react-native-svg`.
- Produces: `genuiLibrary`, `renderers` (one per `GenuiComponentName`).

- [ ] **Step 1: Write the failing table test**

`apps/mobile/src/genui-table.test.ts`: the same two tests as `apps/desktop/app/src/lib/genui-table.test.ts` in Task 2, importing from `./genui-table.ts`.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test apps/mobile/src/genui-table.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the helper**

`apps/mobile/src/genui-table.ts`: the same `squareRows` as Task 2 Step 3. (Two copies of four lines beat a shared export that would pull React-free code through the shared package's `files` list; if a third copy ever appears, move it to `@milagre/shared/genui`.)

- [ ] **Step 4: Run it to see it pass**

Run: `node --test apps/mobile/src/genui-table.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the charts**

`apps/mobile/src/genui/charts.tsx`:

```tsx
import { Text, View } from "react-native";
import Svg, { Circle, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { GenuiProps } from "@milagre/shared/genui";
import { useTheme } from "../theme";

const WIDTH = 320;
const HEIGHT = 140;
const PAD = { top: 8, right: 8, bottom: 22, left: 8 };

export function chartGeometry(values: readonly number[], width = WIDTH, height = HEIGHT) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const inner = { width: width - PAD.left - PAD.right, height: height - PAD.top - PAD.bottom };
  const slot = values.length ? inner.width / values.length : inner.width;
  const y = (value: number) => PAD.top + inner.height - ((value - min) / span) * inner.height;
  return { slot, y, zero: y(0), inner };
}

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
    <View style={{ borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, gap: 6 }}>
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
        <Rect key={index} x={PAD.left + slot * index + slot * 0.15} y={Math.min(y(value), zero)} width={slot * 0.7} height={Math.max(1, Math.abs(zero - y(value)))} rx={2} fill={colors.accent} />
      ))}
      <Labels labels={labels} slot={slot} color={colors.ink3} />
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
      <Labels labels={labels} slot={slot} color={colors.ink3} />
    </Frame>
  );
}
```

- [ ] **Step 6: Write the components**

`apps/mobile/src/genui/components.tsx`:

```tsx
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { GenuiComponentName, GenuiProps } from "@milagre/shared/genui";
import { squareRows } from "../genui-table";
import { useTheme } from "../theme";
import { Button as UiButton, PageScroll } from "../ui";
import { BarChart, LineChart } from "./charts";

export type GenuiRenderer<K extends GenuiComponentName> = (args: ComponentRenderProps<GenuiProps<K>, ReactNode>) => ReactNode;

const GAP = { s: 4, m: 8, l: 16 } as const;

export const Stack: GenuiRenderer<"Stack"> = ({ props, renderNode }) => (
  <View style={{ flexDirection: props.direction === "row" ? "row" : "column", flexWrap: props.direction === "row" ? "wrap" : "nowrap", gap: GAP[props.gap ?? "m"] }}>
    {renderNode(props.children)}
  </View>
);

export const Heading: GenuiRenderer<"Heading"> = ({ props }) => {
  const { colors } = useTheme();
  const level = props.level ?? 2;
  return <Text style={{ color: level === 3 ? colors.ink2 : colors.ink, fontSize: level === 1 ? 17 : level === 2 ? 16 : 15, fontWeight: level === 3 ? "500" : "600", lineHeight: 23 }}>{props.text}</Text>;
};

export const TextBlock: GenuiRenderer<"Text"> = ({ props }) => {
  const { colors } = useTheme();
  const tone = props.tone ?? "default";
  return <Text style={{ color: tone === "muted" ? colors.ink2 : colors.ink, fontWeight: tone === "strong" ? "500" : "400", fontSize: 15, lineHeight: 22 }}>{props.text}</Text>;
};

export const KeyValue: GenuiRenderer<"KeyValue"> = ({ props }) => {
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

export const Table: GenuiRenderer<"Table"> = ({ props }) => {
  const { colors } = useTheme();
  const rows = squareRows(props.columns, props.rows);
  const cellStyle = { paddingHorizontal: 10, paddingVertical: 6, minWidth: 80 } as const;
  return (
    <View style={{ borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" }}>
      <PageScroll horizontal>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line }}>
            {props.columns.map((column, index) => (
              <Text key={index} style={[cellStyle, { color: colors.ink2, fontSize: 13, fontWeight: "500" }]}>
                {column}
              </Text>
            ))}
          </View>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: rowIndex < rows.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              {row.map((cell, cellIndex) => (
                <Text key={cellIndex} style={[cellStyle, { color: colors.ink, fontSize: 14 }]}>
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

export const Callout: GenuiRenderer<"Callout"> = ({ props }) => {
  const { colors } = useTheme();
  const tone = props.tone ?? "info";
  const tint = { info: colors.accentTint, success: colors.greenTint, warning: colors.orangeTint, danger: colors.redTint }[tone];
  const edge = { info: colors.accent, success: colors.green, warning: colors.orange, danger: colors.red }[tone];
  return (
    <View style={{ borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: edge, backgroundColor: tint, paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
      {props.title && <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>{props.title}</Text>}
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{props.body}</Text>
    </View>
  );
};

export const Progress: GenuiRenderer<"Progress"> = ({ props }) => {
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

export const Button: GenuiRenderer<"Button"> = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  return <UiButton title={props.label} secondary={props.variant === "secondary"} disabled={streaming} onPress={() => trigger(props.label, undefined, props.action as never)} />;
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
```

`ui.tsx`'s `Button` fills the row (`alignItems: "center"` in a full-width `View`); inside a row `Stack` two of them wrap. If it looks wrong on the phone, give the wrapper `alignSelf: "flex-start"` by wrapping `UiButton` in `<View style={{ alignSelf: "flex-start" }}>`.

- [ ] **Step 7: Build the library**

`apps/mobile/src/genui/library.ts`:

```ts
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { GENUI_ROOT, genuiDefinitions } from "@milagre/shared/genui";
import { renderers } from "./components";

/** The contract bound to the phone's renderers. */
export const genuiLibrary = createLibrary({
  root: GENUI_ROOT,
  components: genuiDefinitions(renderers).map((definition) => defineComponent(definition as Parameters<typeof defineComponent>[0])),
});
```

- [ ] **Step 8: Typecheck the phone**

Run: `npm run typecheck:mobile`
Expected: clean. If TypeScript resolves `@openuidev/react-lang` to the DOM entry and complains about `react-dom` types, add `"customConditions": ["react-native"]` next to `moduleResolution` in `apps/mobile/tsconfig.json` (only if that key is absent; check first).

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/genui apps/mobile/src/genui-table.ts apps/mobile/src/genui-table.test.ts
git commit -m "feat(genui): phone renderers and library"
```

---

### Task 5: Phone block rendering, postback, test

**Files:**
- Create: `apps/mobile/src/genui/GenerativeUI.tsx`
- Modify: `apps/mobile/src/markdown.tsx:206-220` (fence branch) and `:277-282` (Chunk)
- Modify: `apps/mobile/src/app/chat.tsx:484-491` (next to `sendDesign`) and `:936` (the returned element)
- Modify: `scripts/mobile-ui.test.cjs` (new cases at the end)

**Interfaces:**
- Consumes: `genuiLibrary` (Task 4); `isGenuiFence`, `genuiLimits`, `GENUI_ACTION_TYPE`; `Renderer` from `@openuidev/react-lang`.
- Produces: `GenerativeUI({ code, fallback })`, `GenerativeUIProvider({ send, children })`, `MarkdownStreamingContext`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/mobile-ui.test.cjs`:

```js
function genuiHost({ send = async () => true, streaming = false } = {}) {
  const react = hookHost({ effects: true });
  const actions = [];
  const contexts = new Map();
  react.createContext = (initial) => {
    const context = { initial };
    contexts.set(context, initial);
    return context;
  };
  react.useContext = (context) => contexts.get(context);
  react.Component = class {};
  const source = load(
    "genui/GenerativeUI.tsx",
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { View: "View" },
      "@openuidev/react-lang": { Renderer: "Renderer" },
      "@milagre/shared/genui": require("../packages/shared/src/genui.ts"),
      "./library": { genuiLibrary: "library" },
    },
    "\nexports.TestContexts = { send: SendContext, streaming: MarkdownStreamingContext };",
  );
  contexts.set(source.TestContexts.send, { send });
  contexts.set(source.TestContexts.streaming, streaming);
  return {
    actions,
    render(code) {
      react.begin();
      const tree = source.GenerativeUI({ code, fallback: "Fallback" });
      react.flush();
      return tree;
    },
  };
}

test("a genui block renders through the Renderer and a @ToAssistant action sends its message once", async () => {
  const sent = [];
  let release;
  const h = genuiHost({ send: (text) => new Promise((resolve) => { sent.push(text); release = resolve; }) });
  const renderer = find(h.render("root = Stack([])"), (node) => node.type === "Renderer");
  assert.equal(renderer.props.library, "library");
  assert.equal(renderer.props.isStreaming, false);
  const tap = () => renderer.props.onAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: "Merge them" });
  void tap();
  void tap();
  await settle();
  assert.deepEqual(sent, ["Merge them"], "the second tap during a send is ignored");
  release(true);
  await settle();
  renderer.props.onAction({ type: "open_url", params: { url: "https://example.com" }, humanFriendlyMessage: "" });
  await settle();
  assert.deepEqual(sent, ["Merge them"], "only continue_conversation sends");
});

test("a genui block over the text cap, or without a root once the reply finished, shows the fallback", () => {
  const { genuiLimits } = require("../packages/shared/src/genui.ts");
  const h = genuiHost();
  assert.equal(h.render("x".repeat(genuiLimits.text + 1)), "Fallback");
  const tree = h.render("nothing = Heading(\"no root\")");
  find(tree, (node) => node.type === "Renderer").props.onParseResult({ root: null, meta: {} });
  const after = h.render("nothing = Heading(\"no root\")");
  assert.equal(JSON.stringify(after).includes("Fallback"), true);
});

test("while streaming, a rootless block stays a live Renderer, not the fallback", () => {
  const h = genuiHost({ streaming: true });
  const tree = h.render("root = Stack([title])\ntitle = Heading(\"Strea");
  const renderer = find(tree, (node) => node.type === "Renderer");
  assert.equal(renderer.props.isStreaming, true);
  renderer.props.onParseResult({ root: null, meta: {} });
  assert.equal(JSON.stringify(h.render("root = Stack([title])\ntitle = Heading(\"Strea")).includes("Fallback"), false);
});

test("the phone library binds a renderer to every component of the contract and a button triggers its action", () => {
  const { GENUI_COMPONENTS } = require("../packages/shared/src/genui.ts");
  const triggered = [];
  const components = load(
    "genui/components.tsx",
    {
      react: hookHost(),
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Text: "Text", View: "View" },
      "react-native-svg": { default: "Svg", Circle: "Circle", Polyline: "Polyline", Rect: "Rect", Text: "SvgText" },
      "@openuidev/react-lang": { useTriggerAction: () => (...args) => triggered.push(args), useIsStreaming: () => false },
      "../genui-table": require("../apps/mobile/src/genui-table.ts"),
      "../ui": { Button: "Button", PageScroll: "PageScroll" },
      "./charts": load("genui/charts.tsx", {
        react: hookHost(),
        "react/jsx-runtime": { jsx, jsxs: jsx },
        "react-native": { Text: "Text", View: "View" },
        "react-native-svg": { default: "Svg", Circle: "Circle", Polyline: "Polyline", Rect: "Rect", Text: "SvgText" },
      }),
    },
  );
  assert.deepEqual(Object.keys(components.renderers), Object.keys(GENUI_COMPONENTS));
  const action = { steps: [{ type: "continue_conversation", message: "Go" }] };
  const button = components.renderers.Button({ props: { label: "Go", action }, renderNode: () => null });
  button.props.onPress();
  assert.deepEqual(triggered, [["Go", undefined, action]]);
  const table = components.renderers.Table({ props: { columns: ["a", "b"], rows: [["1"]] }, renderNode: () => null });
  assert.match(JSON.stringify(table), /"1"/);
});
```

`find` and `settle` are the helpers the file already defines near `artifactHost`. The `load` helper refuses unknown imports (`Unexpected import`), so every import of the new files must be listed; add any the first run names.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test scripts/mobile-ui.test.cjs --test-name-pattern genui`
Expected: FAIL, `ENOENT ... genui/GenerativeUI.tsx`.

- [ ] **Step 3: Write `GenerativeUI` and the provider**

`apps/mobile/src/genui/GenerativeUI.tsx`:

```tsx
import { Component, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent, ParseResult } from "@openuidev/react-lang";
import { GENUI_ACTION_TYPE, genuiLimits } from "@milagre/shared/genui";
import { genuiLibrary } from "./library";

type Send = (text: string) => Promise<boolean | "busy">;
const SendContext = createContext<{ send?: Send }>({});

/** Gives every block in the transcript the screen's send function, so a button can post its message. */
export function GenerativeUIProvider({ send, children }: { send?: Send; children: ReactNode }) {
  const value = useMemo(() => ({ send }), [send]);
  return <SendContext value={value}>{children}</SendContext>;
}

/** Whether the surrounding markdown is the chunk of a reply still being written. */
export const MarkdownStreamingContext = createContext(false);

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** An `openui` fence rendered from the contract; `fallback` is the plain fence view, shown when the block can't render. */
export function GenerativeUI({ code, fallback }: { code: string; fallback: ReactNode }) {
  const streaming = useContext(MarkdownStreamingContext);
  const { send } = useContext(SendContext);
  const [rootless, setRootless] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const onParseResult = useCallback((result: ParseResult | null) => setRootless(!result?.root), []);
  const onAction = useCallback(
    async (event: ActionEvent) => {
      if (event.type !== GENUI_ACTION_TYPE || !send || sending.current || !event.humanFriendlyMessage) return;
      sending.current = true;
      setBusy(true);
      try {
        await send(event.humanFriendlyMessage);
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [send],
  );
  if (code.length > genuiLimits.text) return <>{fallback}</>;
  if (rootless && !streaming) return <>{fallback}</>;
  return (
    <Boundary fallback={fallback}>
      <View pointerEvents={busy ? "none" : "auto"} style={{ opacity: busy ? 0.6 : 1 }}>
        <Renderer response={code} library={genuiLibrary} isStreaming={streaming} onParseResult={onParseResult} onAction={onAction} />
      </View>
    </Boundary>
  );
}
```

The desktop version keeps the `Renderer` mounted while it shows the fallback (so `onParseResult` can flip back); here the fallback replaces it, and a `rootless` block that later gains a root (only possible while streaming, where the fallback never shows) is not a case. The second test in Step 1 renders twice to cover the flip.

- [ ] **Step 4: Hook the fence in `markdown.tsx`**

In `apps/mobile/src/markdown.tsx`, import at the top:

```tsx
import { isGenuiFence } from "@milagre/shared/genui";
import { GenerativeUI, MarkdownStreamingContext } from "./genui/GenerativeUI";
```

Replace the fence branch (`if (token.type === "fence" || token.type === "code_block") return (...)`, lines 212-221) with:

```tsx
    if (token.type === "fence" || token.type === "code_block") {
      const plain = (
        <View style={{ backgroundColor: colors.field, borderRadius: 12, borderCurve: "continuous", overflow: "hidden" }}>
          {token.info && <Text style={[styles.label, { paddingHorizontal: 12, paddingTop: 10 }]}>{token.info}</Text>}
          <PageScroll horizontal contentContainerStyle={{ padding: 12, paddingBottom: 12 }}>
            <Text selectable style={styles.code}>
              {token.content.replace(/\n$/, "")}
            </Text>
          </PageScroll>
        </View>
      );
      return (
        <View key={key}>{token.type === "fence" && isGenuiFence(token.info) ? <GenerativeUI code={token.content.replace(/\n$/, "")} fallback={plain} /> : plain}</View>
      );
    }
```

In `Chunk` (line 277), provide the streaming flag:

```tsx
const Chunk = memo(function Chunk({ text, streaming, media, basePath }: { text: string; streaming: boolean } & ImageOptions) {
  const { colors } = useTheme();
  const styles = useStyles();
  const nodes = useMemo(() => tree(markdownTokens(text, streaming)), [text, streaming]);
  return <MarkdownStreamingContext value={streaming}>{blocks(nodes, { media, basePath }, { colors, styles, basePath })}</MarkdownStreamingContext>;
});
```

`markdownChunks` (`chat-presentation.ts:17`) never splits inside a fence, so an open fence is always in the last chunk, which is the one marked streaming.

- [ ] **Step 5: Wrap the screen in the provider**

In `apps/mobile/src/app/chat.tsx`, import `GenerativeUIProvider` from `../genui/GenerativeUI`. Next to `sendDesign` (line 484), add a latest-callback ref and a stable send:

```tsx
  // eslint-disable-next-line react-hooks/refs -- latest-callback ref, read only when a block's button is tapped.
  sendGenui.current = (text: string) => send(text, false);
  const genuiSend = useCallback((text: string) => sendGenui.current(text), []);
```

with `const sendGenui = useRef<(text: string) => Promise<boolean | "busy">>(async () => false);` declared with the screen's other refs. Then wrap the element returned at line 936:

```tsx
  return (
    <GenerativeUIProvider send={genuiSend}>
      ...the existing returned element unchanged...
    </GenerativeUIProvider>
  );
```

`send(text, false)` is the same call the design sheet makes (`sendDesign`, line 485): a plain user message, no attachments.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test scripts/mobile-ui.test.cjs --test-name-pattern genui`
Expected: PASS, 4 tests. Then the whole file: `node --test scripts/mobile-ui.test.cjs` stays green (the chat screen's `load` lists must now include `"../genui/GenerativeUI": { GenerativeUIProvider: "GenerativeUIProvider" }` in `chatHost`, and `markdown.tsx` loads in any test that lists its imports need `"@milagre/shared/genui"` and `"./genui/GenerativeUI"` added; the failure message names each missing one).

- [ ] **Step 7: Typecheck, lint**

Run: `npm run typecheck:mobile && npm run lint`
Expected: clean.

- [ ] **Step 8: Run it on a real phone build**

The Designs QA simulator has a debug build pinned to Metro 8790 (memory note "Main branch sync"). Start Metro from `apps/mobile` on that port, open a Chat against the local Mac, and ask the agent: "Show me the three newest PRs as a table with a Merge button, using an openui block." Confirm the table and button render, the tap posts the message, and a reply that streams shows the block growing. If Metro fails to resolve `@openuidev/react-lang`'s native entry, add to `apps/mobile/metro.config.js` (create it with `getDefaultConfig` from `expo/metro-config` if absent):

```js
config.resolver.unstable_conditionNames = ["react-native", "require", "import"];
```

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/genui/GenerativeUI.tsx apps/mobile/src/markdown.tsx apps/mobile/src/app/chat.tsx scripts/mobile-ui.test.cjs
git commit -m "feat(genui): render openui blocks inline on the phone, buttons post back"
```

---

### Task 6: Skill, prompt line, drift test

**Files:**
- Create: `packages/core/src/bundled-skills/genui/SKILL.md`
- Modify: `packages/core/src/agents/events.cjs:31` (one more instruction string after the Designs one)
- Modify: `packages/core/src/agents/events.test.cjs:625` (next to the design skill test)
- Create: `packages/core/src/bundled-skills.test.cjs`

**Interfaces:**
- Consumes: `GENUI_COMPONENTS` via `require("@milagre/shared/genui")`, `BUNDLED_SKILLS_DIRECTORY`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/bundled-skills.test.cjs`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BUNDLED_SKILLS_DIRECTORY } = require("./bundled-skills.cjs");
const { GENUI_COMPONENTS } = require("@milagre/shared/genui");

const skill = fs.readFileSync(path.join(BUNDLED_SKILLS_DIRECTORY, "genui", "SKILL.md"), "utf8");

test("the genui skill lists every component of the contract with its props in positional order, and nothing else", () => {
  const rows = [...skill.matchAll(/^\| `(\w+)\(([^)]*)\)` \|/gm)].map((match) => [match[1], match[2].split(",").map((arg) => arg.trim().replace(/\?$/, "")).filter(Boolean)]);
  const expected = Object.entries(GENUI_COMPONENTS).map(([name, { props }]) => [name, Object.keys(props.shape)]);
  assert.deepEqual(rows, expected);
});

test("the genui skill marks optional props with a question mark, as the contract does", () => {
  for (const [name, { props }] of Object.entries(GENUI_COMPONENTS)) {
    const row = new RegExp(`^\\| \`${name}\\(([^)]*)\\)\` \\|`, "m").exec(skill);
    assert.ok(row, `${name} is in the skill`);
    const optional = row[1].split(",").map((arg) => arg.trim()).filter((arg) => arg.endsWith("?")).map((arg) => arg.slice(0, -1));
    const expected = Object.entries(props.shape).filter(([, schema]) => schema.safeParse(undefined).success).map(([key]) => key);
    assert.deepEqual(optional, expected, `${name} optional props`);
  }
});
```

In `packages/core/src/agents/events.test.cjs`, after the design skill test (line 629):

```js
test("the instructions point the agent at the bundled genui skill, which exists", () => {
  const file = /read the bundled genui skill at (\S+SKILL\.md)/.exec(MILAGRE_INSTRUCTIONS)?.[1];
  assert.ok(file, "the instructions name the skill's file");
  assert.match(require("node:fs").readFileSync(file, "utf8"), /^name: genui$/m);
  assert.match(MILAGRE_INSTRUCTIONS, /fenced block whose info string is `openui`/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test packages/core/src/bundled-skills.test.cjs packages/core/src/agents/events.test.cjs`
Expected: FAIL, ENOENT for the skill file and "the instructions name the skill's file".

- [ ] **Step 3: Write the skill**

`packages/core/src/bundled-skills/genui/SKILL.md`:

````markdown
---
name: genui
description: Answer with native UI in a Milagre Chat - tables, metrics, callouts, progress, bar and line charts, and buttons that send a message back. Use when a reply shows results with several attributes, numbers, a status, or a choice the user can make with one tap.
---

# Native UI in a reply

Write a fenced block whose info string is `openui`, in OpenUI Lang. Milagre renders it inline, on desktop and phone,
from the components below. Nothing else renders: an unknown component or a bad prop is dropped, a block without
`root` shows as code.

Use a block for: a list of results with several attributes each (a table), a few numbers (key-values), a status or
warning (a callout), a share done (progress), a trend or comparison (a chart), a choice the user makes with one tap
(buttons). Do not use one for code, prose, a single sentence, or anything a markdown list says as well. Keep one or
two blocks per reply, and keep text outside them in markdown.

## Syntax

- One statement per line: `identifier = Expression`. Assign the tree's top to `root`.
- Positional arguments only, in the order of the table: `Table(["PR", "CI"], [["#1", "green"]])`. Never `columns: [...]`.
- Literals: `"text"`, `12`, `0.5`, `true`, `null`, lists `[a, b]`, pairs `[["k", "v"]]`.
- Children are lists of identifiers: `root = Stack([title, table])`. Forward references are fine.
- A button's action: `Action([@ToAssistant("the message to send")])`. Only `@ToAssistant` acts; `@OpenUrl`, `@Set`,
  `Query` and `Mutation` do nothing here.
- No markdown inside strings; they render as plain text.

## Components

Props in positional order; `?` marks an optional one.

| Signature | What it shows |
| --- | --- |
| `Stack(children, direction?, gap?)` | Children vertically, or in a row with `"row"`. Gap `"s"`, `"m"` (default), `"l"`. The root. |
| `Heading(text, level?)` | A title. Level 1 largest, 3 smallest, default 2. |
| `Text(text, tone?)` | A paragraph. Tone `"default"`, `"muted"`, `"strong"`. |
| `KeyValue(pairs)` | Labels and values: `[["Open", "3"], ["Oldest", "4 days"]]`. |
| `Table(columns, rows)` | Headers and rows of strings. Up to 12 columns and 200 rows. |
| `Callout(body, tone?, title?)` | A note. Tone `"info"` (default), `"success"`, `"warning"`, `"danger"`. |
| `Progress(label, value)` | A bar; value from 0 to 1. |
| `BarChart(labels, values, title?)` | Bars, one series, up to 100 points. |
| `LineChart(labels, values, title?)` | A line, one series, up to 100 points. |
| `Button(label, action, variant?)` | Sends `@ToAssistant`'s message as the user's next message. Variant `"primary"` (default) or `"secondary"`. |

## Example

```openui
root = Stack([title, summary, prs, actions])
title = Heading("Three PRs are waiting on you")
summary = KeyValue([["Open", "3"], ["Failing CI", "1"], ["Oldest", "4 days"]])
prs = Table(["PR", "Author", "CI"], [["#403 Worktree link line", "victor", "green"], ["#390 Sidebar Links", "victor", "red"]])
actions = Stack([approve, later], "row")
approve = Button("Merge the green ones", Action([@ToAssistant("Merge the PRs whose CI is green")]))
later = Button("Later", Action([@ToAssistant("Not now")]), "secondary")
```

A tapped button arrives as a user message with that text; answer it as you would any message.
````

- [ ] **Step 4: Add the prompt line**

In `packages/core/src/agents/events.cjs`, after the `Designs:` string (line 31) and before `...(workspaceInstructions ...)`:

```js
    `Native UI: a reply can carry tables, metrics, callouts, progress, bar and line charts, and buttons the user taps to send a message, as a fenced block whose info string is \`openui\`, written in OpenUI Lang. Milagre renders it inline on desktop and phone. Before your first block in a Chat, read the bundled genui skill at ${path.join(BUNDLED_SKILLS_DIRECTORY, "genui", "SKILL.md")}: it has the syntax and the components. Use it for results with several attributes, numbers, a status or a choice; not for code or prose.`,
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test packages/core/src/bundled-skills.test.cjs packages/core/src/agents/events.test.cjs`
Expected: PASS. If the drift test fails on prop order, fix the skill table, never the contract.

Also run `node --test packages/core/src/skills.test.cjs` so the `/` menu test (which may count bundled skills) still passes; if it asserts an exact list, add `genui` to it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bundled-skills/genui/SKILL.md packages/core/src/bundled-skills.test.cjs packages/core/src/agents/events.cjs packages/core/src/agents/events.test.cjs packages/core/src/skills.test.cjs
git commit -m "feat(genui): bundled skill, prompt line and drift test"
```

---

### Task 7: Verification, screenshots, PR

**Files:**
- No source changes expected. Screenshots go to the `screenshots` branch under `genui/`.

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm run lint && npm test -- --unit && npm run typecheck:mobile && MILAGRE_SCREENSHOT_DIR=$TMPDIR/genui npm test -- --only genui && npm test -- --only artifacts`
Expected: all PASS. `test-artifacts.cjs` runs because the markdown and `ChatComposer` changed under it.

- [ ] **Step 2: Desktop in the real app**

Run the dev app (`npm run dev`), open a Chat on a project, and ask: "Show me this repo's five newest commits as a table, with a button to open a PR summary, in an openui block." Confirm the block renders in the reply, the button posts the message, and the agent's reply to that message arrives. Take a screenshot of the block (`$TMPDIR/genui/desktop-real.png`).

- [ ] **Step 3: Phone in the real app**

Repeat Task 5 Step 8 if not already done on this build, and save a simulator screenshot to `$TMPDIR/genui/phone.png`.

- [ ] **Step 4: Push the screenshots**

```bash
git fetch origin screenshots
git worktree add $TMPDIR/milagre-screenshots origin/screenshots
mkdir -p $TMPDIR/milagre-screenshots/genui
cp $TMPDIR/genui/block.png $TMPDIR/genui/sent.png $TMPDIR/genui/streaming.png $TMPDIR/genui/desktop-real.png $TMPDIR/genui/phone.png $TMPDIR/milagre-screenshots/genui/
cd $TMPDIR/milagre-screenshots && git checkout -b screenshots-genui origin/screenshots && git add genui && git commit -m "genui screenshots" && git push origin HEAD:screenshots && git rev-parse HEAD
cd - && git worktree remove $TMPDIR/milagre-screenshots
```

Keep the printed SHA for the PR body.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin milagre/how-can-we-use-https-vz9w
gh pr create --title "feat: agents answer with native UI (openui blocks) on desktop and phone" --body-file - <<'EOF'
An `openui` fenced block in a reply renders as themed native UI inside the answer, on desktop and on the phone: Stack, Heading, Text, KeyValue, Table, Callout, Progress, BarChart, LineChart and Button. A button's `@ToAssistant` sends its text as the next user message. The block streams with the reply and falls back to a code block when it cannot render.

Spec: `docs/superpowers/specs/2026-10-10-generative-ui-design.md`. Plan: `docs/superpowers/plans/2026-10-10-generative-ui.md`.

- Shared contract in `packages/shared/src/genui.ts`; each platform binds its own renderers through `@openuidev/react-lang` (pure JS, the phone ships OTA).
- Bundled `genui` skill plus a prompt line; a test keeps the skill's signature table equal to the contract.
- `scripts/test-genui.cjs` covers rendering, fallback, single send on a double tap, re-enable after a failed send, and the streaming case.

Screenshots (desktop block, after a tap, streaming, real app, phone):

![block](https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/genui/block.png)
![sent](https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/genui/sent.png)
![streaming](https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/genui/streaming.png)
![desktop](https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/genui/desktop-real.png)
![phone](https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/genui/phone.png)

Out of scope, per the spec: inputs and forms, Query/Mutation, a validating tool, more chart kinds, a dock view.
EOF
```

Replace `<sha>` with the SHA from Step 4 before running. OTA publish happens after merge, not in this PR.
