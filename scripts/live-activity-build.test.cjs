const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");

test("EAS discovers the Live Activity signing target before prebuild", () => {
  const mobile = path.resolve(__dirname, "../apps/mobile");
  const mobileRequire = createRequire(path.join(mobile, "package.json"));
  const { getConfig } = mobileRequire("@expo/config");
  const { exp } = getConfig(mobile);
  assert.equal(exp.extra.eas.projectId, "53a87eea-769e-4d7c-a818-b9e2440cc065");
  assert.deepEqual(exp.extra.eas.build.experimental.ios.appExtensions, [
    { targetName: "MilagreAgentActivity", bundleIdentifier: `${exp.ios.bundleIdentifier}.LiveActivity`, entitlements: {} },
  ]);
});
