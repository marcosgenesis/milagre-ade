const test = require("node:test");
const assert = require("node:assert/strict");
const { claudeCapability } = require("./capabilities.cjs");

test("a Claude model with the full effort range offers ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }), { efforts: ["low", "medium", "high", "xhigh", "max"], ultracode: true });
});

test("a Claude model without xhigh keeps its levels but not ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] }), { efforts: ["low", "medium", "high"], ultracode: false });
});

test("a Claude model without effort support has no levels", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: false, supportedEffortLevels: ["low"] }), { efforts: [], ultracode: false });
  assert.deepEqual(claudeCapability({}), { efforts: [], ultracode: false });
});
