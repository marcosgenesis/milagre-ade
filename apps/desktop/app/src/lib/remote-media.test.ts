import assert from "node:assert/strict";
import test from "node:test";

const ID = "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7";
const reads: unknown[] = [];
(globalThis as any).window = {
  milagre: {
    on: () => ({
      readMedia: async (request: { scope: string; path: string }) => {
        reads.push(request);
        if (request.path.endsWith("gone.png")) throw new Error("Image not found");
        return { type: "image/png", size: 3, base64: "AAEC" };
      },
    }),
  },
};
const { remoteImageDataUrl } = await import("./remote-media.ts");

test("a remote image is read once from its computer, as a data URL; a failed read is tried again next time", async () => {
  const scope = `${ID}|/p`;
  assert.equal(await remoteImageDataUrl(scope, "/p/a.png"), "data:image/png;base64,AAEC");
  assert.equal(await remoteImageDataUrl(scope, "/p/a.png"), "data:image/png;base64,AAEC");
  assert.deepEqual(reads, [{ scope, path: "/p/a.png" }]);
  await assert.rejects(remoteImageDataUrl(scope, "/p/gone.png"));
  await assert.rejects(remoteImageDataUrl(scope, "/p/gone.png"));
  assert.equal(reads.length, 3, "a failure isn't kept");
});
