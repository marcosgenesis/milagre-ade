import assert from "node:assert/strict";
import test from "node:test";
import { codeLanguageFromClassName, resolveCodeLanguage } from "./code-languages.ts";

test("fence names resolve to the highlighter's language id", () => {
  assert.equal(resolveCodeLanguage("typescript"), "typescript");
  assert.equal(resolveCodeLanguage("ts"), "typescript");
  assert.equal(resolveCodeLanguage("TSX"), "tsx");
  assert.equal(resolveCodeLanguage("sh"), "shellscript");
  assert.equal(resolveCodeLanguage("zsh"), "shellscript");
  assert.equal(resolveCodeLanguage("console"), "shellsession");
  assert.equal(resolveCodeLanguage("yml"), "yaml");
  assert.equal(resolveCodeLanguage("Dockerfile"), "docker");
  assert.equal(resolveCodeLanguage("c++"), "cpp");
  assert.equal(resolveCodeLanguage("patch"), "diff");
});

test("unknown, empty and plain-text fences are not highlighted", () => {
  assert.equal(resolveCodeLanguage(undefined), undefined);
  assert.equal(resolveCodeLanguage(""), undefined);
  assert.equal(resolveCodeLanguage("text"), undefined);
  assert.equal(resolveCodeLanguage("cobol-2085"), undefined);
  assert.equal(resolveCodeLanguage("constructor"), undefined);
  assert.equal(resolveCodeLanguage("__proto__"), undefined);
});

test("the fence name comes from the code element's language class", () => {
  assert.equal(codeLanguageFromClassName("language-ts"), "ts");
  assert.equal(codeLanguageFromClassName("hljs language-c++ other"), "c++");
  assert.equal(codeLanguageFromClassName(undefined), undefined);
  assert.equal(codeLanguageFromClassName("not-a-language"), undefined);
});
