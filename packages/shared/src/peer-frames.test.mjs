import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameReader, createFrameWriter, PART_THRESHOLD, PIECE_BYTES, MAX_FRAME_BYTES, MAX_PARTS } from "./peer-frames.mjs";

/** The messages a writer produced, opened as the other side would. */
const messages = (texts) => texts.map((text) => JSON.parse(Buffer.from(text).toString("utf8")));
/** A JSON frame of exactly `bytes` UTF-8 bytes. */
const frameOf = (bytes) => JSON.stringify("x".repeat(bytes - 2));
function readAll(reader, list) {
  const frames = [];
  for (const message of list) {
    const read = reader.read(message);
    if (read) frames.push(read.frame);
  }
  return frames;
}

test("the limits fit the relay: a whole message and a part both stay under its 1 MiB frames once sealed", () => {
  assert.equal(PART_THRESHOLD, 768 * 1024);
  assert.equal(PIECE_BYTES, 512 * 1024);
  assert.equal(MAX_FRAME_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_PARTS, 32);
  const sealed = 9 + 16; // the channel's header and the secretbox tag
  const [whole] = createFrameWriter("evt").write(frameOf(PART_THRESHOLD));
  assert.ok(whole.length + sealed <= 1024 * 1024, `whole: ${whole.length}`);
  const [part] = createFrameWriter("evt").write(frameOf(PART_THRESHOLD + 1));
  assert.ok(part.length + sealed <= 1024 * 1024, `part: ${part.length}`);
});

test("a frame of up to 768 KiB is one message; one byte more travels in 512 KiB parts", () => {
  const writer = createFrameWriter("evt");
  const at = frameOf(PART_THRESHOLD);
  const whole = messages(writer.write(at));
  assert.deepEqual(whole, [{ t: "evt", frame: JSON.parse(at) }]);
  const over = frameOf(PART_THRESHOLD + 1);
  const parts = messages(writer.write(over));
  assert.deepEqual(
    parts.map(({ t, id, i, n }) => ({ t, id, i, n })),
    [
      { t: "part", id: 1, i: 0, n: 2 },
      { t: "part", id: 1, i: 1, n: 2 },
    ],
  );
  assert.equal(Buffer.from(parts[0].data, "base64").length, PIECE_BYTES);
  assert.deepEqual(readAll(createFrameReader("evt"), parts), [JSON.parse(over)]);
  assert.equal(messages(writer.write(over))[0].id, 2, "each split frame takes the next id");
});

test("parts reassemble byte for byte when a piece boundary falls inside a character", () => {
  // "ação🙂" is 10 bytes and 512 KiB is not a multiple of 10, so the boundaries cut accented letters and emoji.
  const text = "ação🙂".repeat(300_000);
  const json = JSON.stringify({ v: 1, id: 7, result: text });
  const parts = messages(createFrameWriter("rpc").write(json));
  assert.equal(parts.length, Math.ceil(Buffer.byteLength(json) / PIECE_BYTES));
  assert.deepEqual(readAll(createFrameReader("rpc"), parts), [{ v: 1, id: 7, result: text }]);
});

test("a frame of exactly 16 MiB travels in 32 parts and reads back", () => {
  const parts = messages(createFrameWriter("evt").write(frameOf(MAX_FRAME_BYTES)));
  assert.equal(parts.length, MAX_PARTS);
  const [frame] = readAll(createFrameReader("evt"), parts);
  assert.equal(frame.length, MAX_FRAME_BYTES - 2);
});

test("a reader refuses parts out of order, repeated, cut by another message, or from two frames at once", () => {
  const parts = messages(createFrameWriter("rpc").write(frameOf(3 * PIECE_BYTES)));
  const other = parts.map((part) => ({ ...part, id: 9 }));
  const cases = {
    "starts past the first part": [parts[1]],
    "skips a part": [parts[0], parts[2]],
    "repeats a part": [parts[0], parts[0]],
    "a whole message cuts in": [parts[0], { t: "rpc", frame: { v: 1 } }],
    "another frame's part cuts in": [parts[0], other[1]],
    "changes its count": [parts[0], { ...parts[1], n: 4 }],
  };
  for (const [name, list] of Object.entries(cases)) {
    const reader = createFrameReader("rpc");
    assert.throws(() => readAll(reader, list), { code: "BAD_PART" }, name);
    assert.equal(reader.pending(), false, `${name}: nothing is held after a refusal`);
  }
});

test("malformed parts are BAD_PART, and a frame past the limit is FRAME_TOO_LARGE before it is held", () => {
  const [good] = messages(createFrameWriter("rpc").write(frameOf(PART_THRESHOLD + 1)));
  const cases = {
    "the other direction's message": { t: "evt", frame: {} },
    "an id that is not a number": { ...good, id: "1" },
    "a single part": { ...good, n: 1 },
    "data that is not base64": { ...good, data: "!!!!" },
    "data longer than a piece": { ...good, data: "A".repeat(Math.ceil(PIECE_BYTES / 3) * 4 + 4) },
    "no data": { ...good, data: undefined },
  };
  for (const [name, message] of Object.entries(cases)) assert.throws(() => createFrameReader("rpc").read(message), { code: "BAD_PART" }, name);
  assert.throws(() => createFrameReader("rpc").read({ ...good, n: MAX_PARTS + 1 }), { code: "FRAME_TOO_LARGE" });
  const small = createFrameReader("rpc", { maxBytes: PART_THRESHOLD });
  const parts = messages(createFrameWriter("rpc").write(frameOf(PART_THRESHOLD + 1)));
  assert.equal(small.read(parts[0]), null);
  assert.throws(() => small.read(parts[1]), { code: "FRAME_TOO_LARGE" });
  assert.equal(small.pending(), false);
});

test("reassembled bytes that are not JSON are INVALID_REQUEST", () => {
  const parts = messages(createFrameWriter("rpc").write("x".repeat(PART_THRESHOLD + 1)));
  const reader = createFrameReader("rpc");
  assert.equal(reader.read(parts[0]), null);
  assert.throws(() => reader.read(parts[1]), { code: "INVALID_REQUEST" });
});

test("a writer refuses a frame over 16 MiB with FRAME_TOO_LARGE and its size", () => {
  assert.throws(
    () => createFrameWriter("evt").write(frameOf(MAX_FRAME_BYTES + 1)),
    (error) => error.code === "FRAME_TOO_LARGE" && error.bytes === MAX_FRAME_BYTES + 1,
  );
});
