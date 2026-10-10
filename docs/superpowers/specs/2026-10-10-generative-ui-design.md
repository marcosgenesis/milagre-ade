# Generative UI: agents answer with native tables, metrics, charts and buttons

Date: 2026-10-10. Status: approved design, awaiting spec review.

## Goal

An agent that has results to show (a table of findings, a few metrics, a comparison, a status, a choice) shows them as
themed native UI inside its reply, on the desktop and on the phone, instead of a markdown table or an HTML design in a
frame. A button in that UI sends a user message back, so "Approve" or "Pick B" is one tap.

The agent writes [OpenUI Lang](https://www.openui.com/docs/openui-lang) (Thesys, MIT), a line-oriented language made
for models: `summary = KeyValue([["Open PRs", "12"]])`. Milagre renders it with `@openuidev/react-lang` from a component library
Milagre defines. No generated code runs; the agent can only call registered components with validated props.

## Decisions

| Question | Decision |
| --- | --- |
| Delivery | A fenced block in the reply body with info string `openui`. It streams with the answer, persists as message text, and reaches the phone with no daemon command, bridge allowlist or relay change. Rejected: a `ui_show` MCP tool (no streaming, a step payload to carry, three more files in the daemon). A validating tool can come later if agents produce broken blocks. |
| Placement | Inline, in place of the fence. No dock, no sheet. |
| Interactivity | Display components plus `Button` with `@ToAssistant`. No inputs, no state binding, no `Query` or `Mutation` (runtime tool calls) in this version. |
| Charts | `BarChart` and `LineChart`, hand-rolled SVG on both platforms. `react-native-svg` is already linked, so the phone needs no native build. |
| Component contract | One shared file, `packages/shared/src/genui.ts`, with each component's name, description and Zod props. Each app builds its own `createLibrary` from it with native renderers. |
| Dependencies | `zod` (4.x), `@openuidev/lang-core` and `@openuidev/react-lang`, all pure JavaScript. The runtime has a `react-native` export condition, which Metro on Expo SDK 57 resolves. Phone changes ship OTA. |
| Fallback | A block with no `root`, a parse error, or a renderer error renders as today's code block. Nothing is lost, nothing crashes. |
| Teaching the agent | A bundled `genui` skill with the signatures, pointed at from `milagreInstructions` like the design skill. No settings switch. |
| Postback | A button tap sends its `@ToAssistant` text as a plain user message through the chat's normal send path. |

## Terms

- **Generative UI (genui):** UI the agent describes in OpenUI Lang and Milagre renders from its own components.
- **Block:** one `openui` fence in a reply. A reply may hold several.
- **Component contract:** the shared list of components, their descriptions and props, in `packages/shared/src/genui.ts`.
- **Library:** a platform's `createLibrary` result: the contract bound to that platform's renderers.
- **Postback:** the user message a button sends.

## What the agent writes

One statement per line, `identifier = Expression`, positional arguments only, `root` required:

````markdown
Three PRs are waiting on you.

```openui
root = Stack([summary, prs, actions])
summary = KeyValue([["Open", "3"], ["Failing CI", "1"], ["Oldest", "4 days"]])
prs = Table(["PR", "Author", "CI"], [["#403 Worktree link line", "victor", "green"], ["#390 Sidebar Links", "victor", "red"], ["#377 Issue sheet font", "victor", "green"]])
actions = Stack([approve, later], "row")
approve = Button("Merge the green ones", Action([@ToAssistant("Merge the PRs whose CI is green")]))
later = Button("Later", Action([@ToAssistant("Not now")]), "secondary")
```
````

Lists and objects are literals, `@Each` and expressions work as the language defines them, and anything outside the
contract is dropped by the parser.

## Component contract

`packages/shared/src/genui.ts` exports `GENUI_COMPONENTS`, an ordered record of `{ description, props }` per component.
Prop order is the positional order. Every description is written for the model.

| Component | Props, in order | Notes |
| --- | --- | --- |
| `Stack` | `children: Element[]`, `direction?: "column" \| "row"`, `gap?: "s" \| "m" \| "l"` | Root. Row wraps on the phone. |
| `Heading` | `text: string`, `level?: 1 \| 2 \| 3` | |
| `Text` | `text: string`, `tone?: "default" \| "muted" \| "strong"` | Plain text, no markdown. |
| `KeyValue` | `pairs: [string, string][]` | Two columns, label and value. |
| `Table` | `columns: string[]`, `rows: string[][]` | Cells are strings. A row longer than `columns` is cut, shorter is padded. |
| `Callout` | `body: string`, `tone?: "info" \| "success" \| "warning" \| "danger"`, `title?: string` | Uses the accent, green, orange and red tint tokens. |
| `Progress` | `label: string`, `value: number` | `value` in 0 to 1, clamped. |
| `BarChart` | `labels: string[]`, `values: number[]`, `title?: string` | One series. |
| `LineChart` | `labels: string[]`, `values: number[]`, `title?: string` | One series. |
| `Button` | `label: string`, `action: Action`, `variant?: "primary" \| "secondary"` | Only `@ToAssistant` steps act; others are ignored. |

Caps, enforced in the schemas: 200 rows, 12 columns, 100 chart points, 64 KB of block text. Above a cap the block falls
back to a code block.

The contract has no React import, so the daemon can load it too (for the skill test below).

## Rendering

### Shared

`packages/shared/src/genui.ts` also exports `isGenuiFence(info)` (`openui`, case-insensitive) and `genuiLimits`.

### Desktop

- `components/genui/library.tsx` builds the library: `defineComponent` per contract entry with a renderer from
  `components/genui/*.tsx`. Renderers use the Tailwind tokens (`bg-surface`, `border-line`, `text-ink-2`, `rounded-card`)
  and `ScrollArea` for a wide table. Charts are inline SVG sized to the container, axis labels in `text-ink-3`.
- `components/genui/GenerativeUI.tsx` wraps `Renderer` from `@openuidev/react-lang` in an error boundary. It takes
  `code` and `isStreaming`. On error, or when `onParseResult` reports no root, it renders `CodeBlock` with the text.
- `markdown/Markdown.tsx` `pre` handler: when `isGenuiFence(fence)`, render `GenerativeUI` instead of `CodeBlock`.
  `StreamingMarkdown` passes `isStreaming`. An open fence mid-stream already reaches the handler as a code block running to
  the end of the text (`streaming-markdown.ts:22`), so the UI builds up line by line.
- `GenerativeUIProvider` in `ChatComposer.tsx`, next to `ArtifactsProvider`, holds `onSend` (the same function designs use)
  and the chat id. `GenerativeUI` reads it for actions.

### Phone

- `src/genui/library.tsx` and `src/genui/*.tsx`: renderers on `useTheme().colors`, `Button` and `PageScroll` from `ui.tsx`,
  charts with `react-native-svg`. A `Table` wider than the screen scrolls horizontally in `PageScroll`.
- `src/genui/GenerativeUI.tsx`: same contract as desktop, error boundary, fallback to the existing fence view.
- `markdown.tsx:212`: the fence branch checks `isGenuiFence(token.info)` first. `Markdown` already receives `streaming`.
- `GenerativeUIProvider` in `app/chat.tsx` exposes the screen's `send`.

### Postback

`onAction` receives `{ type, params, humanFriendlyMessage, formState }`. For `type === "continue_conversation"`
(`@ToAssistant`), the provider sends `humanFriendlyMessage` as a user message. Other types are ignored. While the reply
streams, `Renderer` disables interactions through `isStreaming`. After a tap, the block's buttons disable until the send
resolves; a failed send (busy Mac, offline) re-enables them and shows nothing else, the composer's own error handling
applies.

## Skill and prompt

- `packages/core/src/bundled-skills/genui/SKILL.md`: when to use a block (results tables, metrics, comparisons, status,
  a choice with buttons), when not to (code, prose, anything a markdown list says as well), the syntax rules that
  matter (one statement per line, positional args, `root` required, `@ToAssistant` only), and the signature table above
  with one example per component.
- `milagreInstructions` (`agents/events.cjs`) gains one line: a reply can carry native UI in an `openui` fence; read the
  skill before the first one. `events.test.cjs` asserts on it.
- `packages/core/src/bundled-skills.test.cjs` (new): the signature table in `SKILL.md` lists exactly the components and
  prop orders of `GENUI_COMPONENTS`, so the skill and the contract cannot drift.
- The `/` menu lists the skill through `discoverSkills` as it does every bundled skill.

## Errors

| Case | Behaviour |
| --- | --- |
| Unknown component or bad props | The parser drops the statement; the rest renders. |
| No `root`, parse error, renderer throw | The block renders as a code block. |
| `Query`, `Mutation`, `@OpenUrl`, `@Set` | Not wired. `Query` and `Mutation` statements render nothing; those action steps are skipped. |
| Over a cap | Code block. |
| Send fails | Buttons re-enable; no toast beyond the composer's own. |

## Testing

- `packages/shared/src/genui.test.ts`: schemas accept the examples, reject over-cap input, `isGenuiFence`.
- `packages/core/src/bundled-skills.test.cjs`: skill matches contract; prompt line present.
- `apps/desktop`: unit test that `Markdown` renders `GenerativeUI` for an `openui` fence and `CodeBlock` for a broken one.
- `scripts/test-genui.cjs` (Electron): a fixed reply with every component, screenshot, click a button, the postback
  appears as the next user message. Saves to `MILAGRE_SCREENSHOT_DIR`.
- `scripts/mobile-ui.test.cjs`: one case rendering the same reply on the phone and tapping a button.
- Manual: a real Chat on desktop and on the phone against a Mac over LAN; verify streaming builds the UI line by line.
- PR screenshots on the `screenshots` branch under `genui/`.

## Order of work

1. Shared contract, schemas and tests. Dependencies added to `packages/shared`, `apps/desktop`, `apps/mobile`.
2. Desktop renderers, `GenerativeUI`, markdown hook, provider, unit test.
3. Phone renderers, `GenerativeUI`, markdown hook, provider.
4. Postback on both platforms.
5. Skill, prompt line, drift test.
6. Electron check, phone check, manual run, screenshots, PR. OTA after merge.

## Out of scope

- Inputs, selects, state binding and multi-field forms.
- `Query` and `Mutation` (runtime tool calls from the UI).
- A validating MCP tool, OpenUI Gateway, Autofix and Observability.
- Pie, area and sparkline charts, multi-series charts.
- A dock or sheet view for large blocks.
- Rendering blocks inside subagent transcript tails.
