const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLiveActivity } = require("./live-activity.cjs");
const deviceId = "b6e2df4b-972b-4e7b-bc65-6cda0a173798";
const q = (id = "q") => ({
  id,
  header: "Scope",
  question: "Include it?",
  options: [{ label: "Add it (Recommended)" }, { label: "Later" }],
  secret: false,
  multiSelect: false,
  allowOther: true,
});
function fixture({ questions = [q()], accepted = true, answer } = {}) {
  const request = { requestId: "request", questions };
  const run = { startedAt: 10, steps: [], questions: [request], approvals: [] };
  const state = { sessions: { 1: { id: 1, title: "Screenshot paste" } }, messages: [] };
  const snapshot = { projects: [{ path: "/repo", state }], links: [], runs: { runs: { "/repo#1": run } } };
  const calls = [];
  const service = createLiveActivity({
    snapshot: () => snapshot,
    answer:
      answer ??
      (async (data) => {
        calls.push(data);
        if (accepted) run.questions = [];
        return accepted;
      }),
    newId: () => "target",
    now: () => 100,
  });
  return { service, run, calls };
}
test("a complete choice submits the original label and records its summary", async () => {
  const { service, calls } = fixture();
  const state = service.state({ deviceId });
  const result = await service.choose({ deviceId, target: state.question.target, position: 1, option: 0 });
  assert.equal(result.status, "accepted");
  assert.deepEqual(calls[0].answers, { q: ["Add it (Recommended)"] });
  assert.equal(calls[0].summary, "Scope: Add it (Recommended)");
  assert.equal(service.state({ deviceId }).question, null);
});
test("multiple questions are drafts until the complete set can reach the agent", async () => {
  const { service, calls } = fixture({ questions: [q(), q("q2")] });
  service.state({ deviceId });
  assert.equal((await service.choose({ deviceId, target: "target", position: 1, option: 0 })).status, "draft");
  assert.equal(calls.length, 0);
  assert.equal(service.state({ deviceId }).question.position, 2);
  assert.equal((await service.choose({ deviceId, target: "target", position: 2, option: 1 })).status, "accepted");
  assert.deepEqual(calls[0].answers, { q: ["Add it (Recommended)"], q2: ["Later"] });
});
test("a resolved request cannot answer a later turn", async () => {
  const { service, run, calls } = fixture();
  service.state({ deviceId });
  run.questions = [];
  await assert.rejects(service.choose({ deviceId, target: "target", position: 1, option: 0 }), /no longer waiting/);
  assert.equal(calls.length, 0);
});
test("an action from the previous question cannot choose the following question", async () => {
  const { service, calls } = fixture({ questions: [q(), q("q2")] });
  service.state({ deviceId });
  await service.choose({ deviceId, target: "target", position: 1, option: 0 });
  await assert.rejects(service.choose({ deviceId, target: "target", position: 1, option: 1 }), /question changed/);
  assert.equal(calls.length, 0);
});
test("duplicate taps cannot submit two answers while acceptance is pending", async () => {
  let finish;
  let calls = 0;
  const { service } = fixture({
    answer: () => {
      calls++;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  service.state({ deviceId });
  const pending = service.choose({ deviceId, target: "target", position: 1, option: 0 });
  await assert.rejects(service.choose({ deviceId, target: "target", position: 1, option: 0 }), /already being sent/);
  finish(true);
  assert.equal((await pending).status, "accepted");
  assert.equal(calls, 1);
});
test("rejection is not reported as acceptance and retains the question", async () => {
  const { service } = fixture({ accepted: false });
  service.state({ deviceId });
  assert.equal((await service.choose({ deviceId, target: "target", position: 1, option: 0 })).status, "rejected");
  assert.ok(service.state({ deviceId }).question);
});
test("secret, multi-select and long requests cannot be answered from a small surface", async () => {
  for (const extra of [{ secret: true }, { multiSelect: true }, { question: "a".repeat(121) }]) {
    const { service, calls } = fixture({ questions: [{ ...q(), ...extra }] });
    service.state({ deviceId });
    await assert.rejects(service.choose({ deviceId, target: "target", position: 1, option: 0 }), /Open Chat/);
    assert.equal(calls.length, 0);
  }
});
test("drafts are scoped to a Device and removed when tracking is disabled", async () => {
  const { service } = fixture({ questions: [q(), q("q2")] });
  service.state({ deviceId });
  await service.choose({ deviceId, target: "target", position: 1, option: 0 });
  assert.equal(service.state({ deviceId: "91d13e16-0d24-40e2-bd36-59e2c763d42e" }).question.position, 1);
  service.forget(deviceId);
  assert.equal(service.state({ deviceId }).question.position, 1);
});

test("an accepted request stays closed until the runtime publishes its removal", async () => {
  const { service, calls } = fixture({
    answer: async (data) => {
      calls.push(data);
      return true;
    },
  });
  service.state({ deviceId });
  await service.choose({ deviceId, target: "target", position: 1, option: 0 });
  assert.equal(service.state({ deviceId }).question, null);
  await assert.rejects(service.choose({ deviceId, target: "target", position: 1, option: 0 }), /no longer waiting/);
  assert.equal(calls.length, 1);
  assert.equal(service.open({ deviceId, target: "target" }).sessionId, 1);
});

test("active subagents remain visible after their owning Chat's main turn ends", () => {
  const service = createLiveActivity({
    snapshot: () => ({
      projects: [{ path: "/repo", state: { sessions: { 2: { id: 2, title: "Review", subagents: [{ id: "child", status: "running" }] } }, messages: [] } }],
      runs: { runs: {} },
    }),
    answer: async () => false,
  });
  const content = service.state({ deviceId });
  assert.equal(content.runningCount, 1);
  assert.deepEqual(content.rows, [{ title: "Review", status: "Subagents running" }]);
});

test("a Named Link question resolves to its Link scope and Chat", () => {
  const request = { requestId: "request", questions: [q()] };
  const service = createLiveActivity({
    snapshot: () => ({
      links: [{ linkId: "group", state: { sessions: { 1: { id: 1, title: "Linked review" } }, messages: [] } }],
      runs: { runs: { "milagre-link:group#1": { startedAt: 10, questions: [request], approvals: [] } } },
    }),
    answer: async () => false,
  });
  const content = service.state({ deviceId });
  assert.equal(content.waitingCount, 1);
  assert.equal(service.open({ deviceId, target: content.question.target }).projectPath, "milagre-link:group");
});
test("questions-only mode survives drafts and acceptance while another agent runs", async () => {
  const { service, run } = fixture({ questions: [q(), q("q2")] });
  const current = service.state({ deviceId, mode: "questions" });
  assert.equal(current.runningCount, 0);
  const draft = await service.choose({ deviceId, target: current.question.target, position: 1, option: 0, mode: "questions" });
  assert.equal(draft.content.question.position, 2);
  const accepted = await service.choose({ deviceId, target: current.question.target, position: 2, option: 0, mode: "questions" });
  assert.equal(accepted.content.waitingCount, 0);
  assert.equal(accepted.content.runningCount, 0);
  run.questions = [];
  assert.equal(service.state({ deviceId }).runningCount, 1);
});
test("invalid display modes are rejected", async () => {
  const { service } = fixture();
  assert.throws(() => service.state({ deviceId, mode: "unknown" }), /display mode/);
  await assert.rejects(service.choose({ deviceId, mode: "unknown" }), /display mode/);
});
test("rejected complete answers retain every draft choice for Open Chat", async () => {
  const { service } = fixture({ questions: [q(), q("q2")], accepted: false });
  service.state({ deviceId });
  await service.choose({ deviceId, target: "target", position: 1, option: 0 });
  const rejected = await service.choose({ deviceId, target: "target", position: 2, option: 1 });
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(service.open({ deviceId, target: "target" }).answers, { q: ["Add it (Recommended)"], q2: ["Later"] });
});
test("a failed final submission retains every draft choice without retrying", async () => {
  let calls = 0;
  const { service } = fixture({
    questions: [q(), q("q2")],
    answer: async () => {
      calls++;
      throw Error("Lost acknowledgement");
    },
  });
  service.state({ deviceId });
  await service.choose({ deviceId, target: "target", position: 1, option: 0 });
  await assert.rejects(service.choose({ deviceId, target: "target", position: 2, option: 1 }), /Lost acknowledgement/);
  assert.deepEqual(service.open({ deviceId, target: "target" }).answers, { q: ["Add it (Recommended)"], q2: ["Later"] });
  assert.equal(calls, 1);
});
