---
name: genui
description: Answer with native UI in a Milagre Chat - tables, metrics, callouts, progress, bar and line charts, and buttons that send a message back. Use when a reply shows results with several attributes, numbers, a status, or a choice the user can make with one tap.
---

# Native UI in a reply

Write a fenced block whose info string is `openui`, in OpenUI Lang. Milagre renders it inline, on desktop and phone,
from the components below. Nothing else renders: an unknown component or a bad prop is dropped, a block without
`root` shows as code.

Use a block for: a list of results with several attributes each (a table), a few numbers (key-values), a status or
warning (a callout), a share done (progress), a trend or comparison (a chart), a choice the user makes with one tap
(buttons). Do not use one for code, prose, a single sentence, or anything a markdown list says as well. Keep one or
two blocks per reply, and keep text outside them in markdown.

## Syntax

- One statement per line: `identifier = Expression`. Assign the tree's top to `root`.
- Positional arguments only, in the order of the table: `Table(["PR", "CI"], [["#1", "green"]])`. Never `columns: [...]`.
- Literals: `"text"`, `12`, `0.5`, `true`, `null`, lists `[a, b]`, pairs `[["k", "v"]]`.
- Children are lists of identifiers: `root = Stack([title, table])`. Forward references are fine.
- A button's action: `Action([@ToAssistant("the message to send")])`. Only `@ToAssistant` acts; `@OpenUrl`, `@Set`,
  `Query` and `Mutation` do nothing here.
- No markdown inside strings; they render as plain text.

## Components

Props in positional order; `?` marks an optional one.

| Signature | What it shows |
| --- | --- |
| `Stack(children, direction?, gap?)` | Children vertically, or in a row with `"row"`. Gap `"s"`, `"m"` (default), `"l"`. The root. |
| `Heading(text, level?)` | A title. Level 1 largest, 3 smallest, default 2. |
| `Text(text, tone?)` | A paragraph. Tone `"default"`, `"muted"`, `"strong"`. |
| `KeyValue(pairs)` | Labels and values: `[["Open", "3"], ["Oldest", "4 days"]]`. |
| `Table(columns, rows)` | Headers and rows of strings. Up to 12 columns and 200 rows. |
| `Callout(body, tone?, title?)` | A note. Tone `"info"` (default), `"success"`, `"warning"`, `"danger"`. |
| `Progress(label, value)` | A bar; value from 0 to 1. |
| `BarChart(labels, values, title?)` | Bars, one series, up to 100 points. |
| `LineChart(labels, values, title?)` | A line, one series, up to 100 points. |
| `Button(label, action, variant?)` | Sends `@ToAssistant`'s message as the user's next message. Variant `"primary"` (default) or `"secondary"`. |

## Example

```openui
root = Stack([title, summary, prs, actions])
title = Heading("Three PRs are waiting on you")
summary = KeyValue([["Open", "3"], ["Failing CI", "1"], ["Oldest", "4 days"]])
prs = Table(["PR", "Author", "CI"], [["#403 Worktree link line", "victor", "green"], ["#390 Sidebar Links", "victor", "red"]])
actions = Stack([approve, later], "row")
approve = Button("Merge the green ones", Action([@ToAssistant("Merge the PRs whose CI is green")]))
later = Button("Later", Action([@ToAssistant("Not now")]), "secondary")
```

A tapped button arrives as a user message with that text; answer it as you would any message.
