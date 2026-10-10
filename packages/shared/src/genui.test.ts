import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary, defineComponent, generatePrompt } from "@openuidev/lang-core";
import {
  CHART_HEIGHT,
  CHART_PAD,
  CHART_WIDTH,
  GENUI_COMPONENTS,
  GENUI_ROOT,
  chartGeometry,
  genuiDefinitions,
  genuiLimits,
  isGenuiFence,
  squareRows,
} from "./genui.ts";

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

test("rows are cut or padded to the columns and cells become strings", () => {
  assert.deepEqual(squareRows(["a", "b"], [["1"], ["1", "2", "3"], [4, null]]), [
    ["1", ""],
    ["1", "2"],
    ["4", ""],
  ]);
  assert.deepEqual(squareRows([], [["x"]]), [[]]);
});

test("chart geometry puts zero on the baseline, scales to the largest value and never divides by zero", () => {
  const { y, zero, slot } = chartGeometry([0, 5, 10]);
  assert.equal(zero, CHART_PAD.top + CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom);
  assert.equal(y(10), CHART_PAD.top);
  assert.equal(slot, (CHART_WIDTH - CHART_PAD.left - CHART_PAD.right) / 3);
  assert.equal(chartGeometry([]).y(0), chartGeometry([]).zero);
  assert.equal(chartGeometry([3, 3]).y(3), CHART_PAD.top);
});

test("the prompt names the button action by its tag instead of spelling out the union", () => {
  const names = Object.keys(GENUI_COMPONENTS) as (keyof typeof GENUI_COMPONENTS)[];
  const renderers = Object.fromEntries(names.map((name) => [name, null])) as Record<keyof typeof GENUI_COMPONENTS, null>;
  const library = createLibrary({
    root: GENUI_ROOT,
    components: genuiDefinitions(renderers).map((definition) => defineComponent(definition)),
  });
  const prompt = generatePrompt(library.toSpec());
  const button = prompt.split("\n").find((line) => line.startsWith("Button("));
  assert.ok(button, "the prompt has a Button signature line");
  assert.ok(button.includes("ActionExpression"), button);
  assert.equal(button.includes("continue_conversation"), false, button);
});

test("the rendering parser evaluates actions, normalizes table cells, and enforces caps before rendering", async () => {
  const { parseGenui } = await import("./genui.ts");
  const result = parseGenui(
    'root = Stack([table, go])\ntable = Table(["A", "B"], [[4], ["a", "b", "c"]])\ngo = Button("Go", Action([@ToAssistant("Go now")]))',
  );
  const children = result.root!.props.children as { props: Record<string, unknown> }[];
  assert.deepEqual(children[0]!.props.rows, [
    ["4", ""],
    ["a", "b"],
  ]);
  assert.deepEqual(children[1]!.props.action, { steps: [{ type: "continue_conversation", message: "Go now", context: undefined }] });
  for (const expr of [
    `Table(["A"], ${JSON.stringify(Array.from({ length: 201 }, () => ["x"]))})`,
    `Table(${JSON.stringify(Array.from({ length: 13 }, () => "x"))}, [])`,
    `BarChart([], ${JSON.stringify(Array.from({ length: 101 }, () => 1))})`,
  ])
    assert.equal(parseGenui(`root = Stack([${expr}])`).root, null);
});

test("the text cap counts UTF-8 bytes and disabled action types produce no postback", async () => {
  const { genuiTextOverLimit, genuiActionEvents } = await import("./genui.ts");
  assert.equal(genuiTextOverLimit("é".repeat(32768)), false);
  assert.equal(genuiTextOverLimit("é".repeat(32769)), true);
  assert.equal(genuiTextOverLimit("😀".repeat(16385)), true);
  assert.deepEqual(
    genuiActionEvents("Go", {
      steps: [
        { type: "set", target: "x", valueAST: {} },
        { type: "open_url", url: "https://example.com" },
        { type: "run", statementId: "q" },
      ],
    }),
    [],
  );
  assert.deepEqual(genuiActionEvents("Go", { steps: [{ type: "continue_conversation", message: "Go now" }] }), [
    { type: "continue_conversation", params: {}, humanFriendlyMessage: "Go now" },
  ]);
});
