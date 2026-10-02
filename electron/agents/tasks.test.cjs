const assert = require("node:assert/strict");
const test = require("node:test");
const { applyToolResult, applyToolUse, codexPlanTasks, todoWriteTasks } = require("./tasks.cjs");

test("TodoWrite: ids are positions, blank items drop and unknown statuses are pending", () => {
  assert.deepEqual(todoWriteTasks({ todos: [{ content: " A ", status: "completed" }, { content: "", status: "pending" }, { content: "B", status: "weird", activeForm: "Doing B" }] }), [
    { id: "0", content: "A", status: "completed" },
    { id: "2", content: "B", activeForm: "Doing B", status: "pending" },
  ]);
  assert.equal(todoWriteTasks({}), null);
  assert.equal(todoWriteTasks(undefined), null);
});

test("TodoWrite replaces whatever the map held", () => {
  const map = new Map([["9", { id: "9", content: "Old", status: "pending" }]]);
  assert.deepEqual(applyToolUse(map, "TodoWrite", { todos: [{ content: "New", status: "pending" }] }).map((task) => task.content), ["New"]);
  assert.deepEqual(applyToolUse(map, "TodoWrite", { todos: [] }), []);
});

test("TaskCreate adds on its result; TaskUpdate edits and deletes", () => {
  const map = new Map();
  const call = { id: "c", name: "TaskCreate", input: { subject: "A", description: "d", activeForm: "Doing A" } };
  assert.equal(applyToolUse(map, "TaskCreate", call.input), null);
  assert.equal(applyToolResult(map, call, { content: "x", is_error: true }, undefined), null);
  assert.deepEqual(applyToolResult(map, call, { content: "x" }, { task: { id: 7, subject: "A" } }), [{ id: "7", content: "A", activeForm: "Doing A", status: "pending" }]);
  assert.deepEqual(applyToolUse(map, "TaskUpdate", { taskId: "7", subject: "A2", status: "completed" }), [{ id: "7", content: "A2", activeForm: "Doing A", status: "completed" }]);
  assert.equal(applyToolUse(map, "TaskUpdate", { taskId: "8", status: "completed" }), null);
  assert.deepEqual(applyToolUse(map, "TaskUpdate", { taskId: "7", status: "deleted" }), []);
});

test("TaskList is authoritative but keeps known activeForm", () => {
  const map = new Map([["1", { id: "1", content: "A", activeForm: "Doing A", status: "pending" }], ["2", { id: "2", content: "B", status: "pending" }]]);
  const tasks = applyToolResult(map, { id: "l", name: "TaskList", input: {} }, { content: "x" }, { tasks: [{ id: "1", subject: "A", status: "in_progress" }] });
  assert.deepEqual(tasks, [{ id: "1", content: "A", activeForm: "Doing A", status: "in_progress" }]);
  assert.equal(applyToolResult(map, { id: "l", name: "TaskList", input: {} }, { content: "x" }, undefined), null);
});

test("Codex plan: inProgress becomes in_progress", () => {
  assert.deepEqual(codexPlanTasks([{ step: "A", status: "inProgress" }, { step: "B", status: "pending" }]), [{ id: "0", content: "A", status: "in_progress" }, { id: "1", content: "B", status: "pending" }]);
  assert.equal(codexPlanTasks(null), null);
});
