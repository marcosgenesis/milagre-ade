import assert from "node:assert/strict";
import test from "node:test";
import { fileLanguage, highlightFile, syntaxColors } from "./file-syntax.mjs";

const code = '// A component\r\nexport const Card = ({ title }: { title: string }) => (\r\n  <section aria-label="card">{title}</section>\r\n);\r\n';

test("TSX previews color TypeScript and JSX without changing the file text", () => {
  const tokens = highlightFile(code, "/project/Card.tsx");
  assert.equal(tokens.map((token) => token.text).join(""), code);
  for (const [text, kind] of [
    ["export", "keyword"],
    ["string", "type"],
    ["section", "tag"],
    ["card", "string"],
    ["// A component", "comment"],
  ]) {
    assert.ok(
      tokens.some((token) => token.text.includes(text) && token.kind === kind),
      `${text} is ${kind}`,
    );
  }
  assert.notEqual(syntaxColors.keyword.light, syntaxColors.string.light);
  assert.notEqual(syntaxColors.keyword.dark, syntaxColors.string.dark);
});

test("file names select supported languages on either platform", () => {
  for (const [name, expected] of [
    ["C:\\project\\Card.TSX", "tsx"],
    ["app.mts", "typescript"],
    ["app.cjs", "javascript"],
    ["view.jsx", "jsx"],
    ["data.json", "json"],
    ["styles.css", "css"],
    ["script.py", "python"],
    ["Dockerfile", "docker"],
    ["Makefile", "makefile"],
  ]) {
    assert.equal(fileLanguage(name), expected);
  }
  assert.equal(fileLanguage("notes.txt"), undefined);
  assert.equal(fileLanguage("README"), undefined);
});

test("unknown and large files stay readable without running a grammar", () => {
  for (const [text, name] of [
    ["<b>& hello\n", "notes.txt"],
    ["const value = 1;\n".repeat(5000), "large.ts"],
  ]) {
    assert.deepEqual(highlightFile(text, name), [{ text, kind: "plain" }]);
  }
  assert.equal(
    highlightFile("", "empty.ts")
      .map((token) => token.text)
      .join(""),
    "",
  );
});
