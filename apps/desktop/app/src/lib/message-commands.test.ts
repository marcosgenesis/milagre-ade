import test from "node:test";
import assert from "node:assert/strict";
import { messageCommands } from "./message-commands.ts";

const messages = [1, 2, 3, 4]
  .map((id) => ({ id, session_id: 1, body: `deploy the relay, try ${id}` }))
  .concat([
    { id: 5, session_id: 2, body: "deploy notes for an archived chat" },
    { id: 6, session_id: 3, body: "relay deploy from the other chat" },
  ]);

test("lists at most three messages per listed chat, titled by their chat", () => {
  const opened: Array<[number, string]> = [];
  const commands = messageCommands(
    messages,
    "deploy",
    new Map([
      [1, "Relay"],
      [3, "Other"],
    ]),
    (id, term) => opened.push([id, term]),
  );
  assert.deepEqual(
    commands.map((command) => [command.detail, command.group]),
    [
      ["Other", "Messages"],
      ["Relay", "Messages"],
      ["Relay", "Messages"],
      ["Relay", "Messages"],
    ],
  );
  const other = commands.find((command) => command.detail === "Other")!;
  assert.equal(other.label.slice(...other.highlight!), "deploy");
  void other.run();
  assert.deepEqual(opened, [[3, "deploy"]]);
});
