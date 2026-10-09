import { test } from "node:test";
import assert from "node:assert/strict";
import { currentChoice, setChoicePresenter, showChoiceSheet } from "./choice-store.ts";

test("a choice applies an enabled option once; dismissing keeps the previous selection", () => {
  let shown = 0;
  const picks: string[] = [];
  setChoicePresenter(() => {
    shown++;
  });
  const open = () =>
    showChoiceSheet({
      title: "Branch from",
      placeholder: "Search branches",
      emptyLabel: "No branches found.",
      items: [
        { id: "main", title: "main", checked: true },
        { id: "release", title: "release" },
        { id: "locked", title: "locked", disabled: true },
      ],
      onSelect: (id) => picks.push(id),
    });
  open();
  const first = currentChoice()!;
  first.choose("release");
  first.choose("main");
  assert.deepEqual(picks, ["release"]);
  assert.equal(currentChoice(), null);
  open();
  currentChoice()!.choose(null);
  assert.deepEqual(picks, ["release"]);
  open();
  currentChoice()!.choose("locked");
  assert.deepEqual(picks, ["release"]);
  assert.equal(shown, 3);
});

test("replacing a picker cancels its stale callback", () => {
  const picks: string[] = [];
  const open = (name: string) =>
    showChoiceSheet({
      title: name,
      placeholder: "Search",
      emptyLabel: "No results.",
      items: [{ id: "main", title: "main" }],
      onSelect: (id) => picks.push(`${name}:${id}`),
    });
  open("First");
  const first = currentChoice()!;
  open("Second");
  first.choose("main");
  currentChoice()!.choose("main");
  assert.deepEqual(picks, ["Second:main"]);
});
