import assert from "node:assert/strict";
import test from "node:test";

(globalThis as any).window = { milagre: {}, addEventListener() {}, removeEventListener() {} };
const { computerScopes, mergeScopes } = await import("./computer-scopes.ts");

const A = "c-arketa";
const S = "c-studio";
test("a computer's Projects (hidden left out) then its Links, keyed as the window keeps them", () => {
  const scopes = computerScopes(
    A,
    [
      { path: `${A}|/a/web`, name: "arketa-web", openedAt: "" },
      { path: `${A}|/a/old`, name: "old", openedAt: "", hidden: true },
    ],
    [{ id: `${A}|f1713d69-569d-405b-a0b2-19bfdf565a76`, name: "Checkout", projectIds: [], createdAt: "" } as any],
  );
  assert.deepEqual(
    scopes.map((scope) => [scope.key, scope.name, scope.computerId, Boolean(scope.link)]),
    [
      [`${A}|/a/web`, "arketa-web", A, false],
      [`milagre-link:${A}|f1713d69-569d-405b-a0b2-19bfdf565a76`, "Checkout", A, true],
    ],
  );
});

test("every computer's scopes in one list: Projects by name, then Links; on a tie, This Mac first, then the computers in order", () => {
  const scope = (key: string, name: string, computerId: string, link = false) => ({ key, name, computerId, link: link ? {} : null });
  const merged = mergeScopes(
    [
      scope("/work/milagre-ade", "milagre-ade", "local"),
      scope(`${S}|/s/homelab`, "homelab", S),
      scope(`${A}|/a/web`, "arketa-web", A),
      scope(`${S}|/s/app`, "app", S),
      scope("/work/app", "App", "local"),
      scope("milagre-link:x", "Checkout", "local", true),
      scope(`${A}|/a/app`, "app", A),
    ],
    [A, S],
  );
  assert.deepEqual(
    merged.map((item) => item.key),
    ["/work/app", `${A}|/a/app`, `${S}|/s/app`, `${A}|/a/web`, `${S}|/s/homelab`, "/work/milagre-ade", "milagre-link:x"],
  );
});
