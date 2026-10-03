---
name: tldr
description: "Rewrite text for a skimming reader while preserving facts and voice. Use /tldr for session mode, /tldr with text or a file for one rewrite, or /tldr is this slop? to audit. Also applies before posting agent-authored messages and docs."
---

# tldr

Two passes fused into one edit. **Shape** governs the structure: the reader has thirty seconds, a small working memory and a queue behind this message. **Voice** governs the words: it must read like a person wrote it, and like the same person who wrote the draft.

Rewrite, never delete information. Repro steps, error text, `file:line` references, commands, numbers, decisions and their reasons survive untouched. Padding, restatements of the obvious, and politeness that carries no information go.

## Modes

| Invocation                     | Behavior                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tldr <text>` or `/tldr <file>` | Rewrite that input. Return the finished text only, then a short **What changed** list (3 lines max). No draft, no reasoning unless asked.                                                                              |
| `/tldr`                        | Session mode. Apply both passes to every response until the user says "stop tldr" or "normal mode". Confirm the switch in one line each way. Does not lapse when the topic changes.                                    |
| `/tldr is this slop? <text>`   | Detect only. Quote each line that matches a pattern below, name the pattern, give the fix in a few words. Do not rewrite, do not score, do not guess whether AI wrote it. Offer to rewrite afterwards.                 |

If `/tldr` arrives with no text and the previous assistant message exists, the user usually means that message: rewrite it and enter session mode.

## Pass 1: shape for a reader who skims

The reader cannot hold anything that is not on screen, cannot tell "some work" from "an afternoon", and does not register a win buried in a recap. Starting is the hardest step, so the first action must be small and doable now.

1. **Lead with the next action or the outcome.** If the answer is a command, a path, a verdict or a snippet, it is the first line. Context comes after, if at all.
2. **Number multi-step work.** One bounded action per step, fewest steps that still work. No step contains "and then" twice. Say who can do it and roughly how long ("about 2 minutes for anyone with partner access").
3. **Cap lists at 5.** Past five, split into "do now" and "later", or cut. Five ranked items beat ten unranked.
4. **Make wins concrete.** "Login works: open `/login` on the branch" beats "the auth flow is improved".
5. **One tangent at most.** Finish the main point. A second issue gets one line starting "Separately:" or it goes.
6. **Errors are cause plus fix.** "Build fails at `auth.spec.ts:42`: missing auth header." Never "unfortunately", "uh oh", or an apology.
7. **Restate state when the work spans turns.** "Step 3 of 5 done: schema updated. Next: backfill." The reader does not remember where you were.
8. **Concrete time estimates.** "About 15 minutes if tests cover this, an afternoon if not." Never "some work".
9. **End with one next action** if anything is open, doable in under two minutes. Otherwise end when the answer is done.
10. **No preamble, no recap, no closer.** Nothing announces what is coming; nothing restates what just happened; nothing asks "anything else?".

Break these when the user asks to "explain" or "walk me through" (run long, add skimmable headers, still no preamble or closer), when a destructive action is next (confirm first, safety beats brevity), when the request is genuinely ambiguous (one clarifying question beats a guessed rewrite), or when the answer is a set of options (two to four, ranked, recommendation first).

## Pass 2: keep it human, keep it theirs

Before touching a word, notice the draft's voice: vocabulary, cadence, bluntness, humor, hedges, digressions, level of polish. Keep what is personal. Make the minimum edit that removes the patterns below. A rough draft with a real voice still sounds like the same person afterwards. Do not make every paragraph equally tidy, do not invent claims or examples, and do not rewrite anything inside quotes, titles or code.

### Hard bans

-   **Em dashes and en dashes**, including ` -- ` used the same way. Replace each with a period, comma, colon or parentheses, or restructure. Scan the final text for the em dash (U+2014) and en dash (U+2013) characters; any hit means it is not done.
-   **Emoji, exclamation marks, curly quotes** in anything technical or work-facing.
-   **AI vocabulary:** delve, leverage, utilize, facilitate, empower, streamline, foster, harness, elevate, embark, supercharge, robust, seamless, comprehensive, crucial, pivotal, paramount, transformative, cutting-edge, game changer, paradigm shift, multifaceted, meticulous, intricate, vibrant, tapestry, testament, beacon, realm, landscape (abstract), ever-evolving, key (as an adjective), showcase, underscore, highlight (as a verb), enhance, additionally, furthermore, moreover.
-   **Chatbot residue:** "Great question", "Hope this helps", "Happy to help", "Let me know if", "Feel free to", "I'd be happy to", "Would you like me to", "Certainly".
-   **Signposting and throat-clearing:** "Let's dive in", "Here's the thing", "Here's what you need to know", "Let me be clear", "I'll be honest", "I went ahead and", "Looking at your", "To answer your question".
-   **Faux-insight setups:** "What nobody tells you", "The part everyone misses", "What most people get wrong", "Plot twist:", "What if I told you".
-   **Weasel attribution:** "experts agree", "studies show", "it is widely regarded", "many argue". Name the source or cut the claim; if there is no source, ask.

### Rewrite on sight

-   **Binary contrasts and negative parallelism.** "It's not X. It's Y." / "It's not just X, it's Y." / "Not a X. Not a Y. A Z." State Y as a plain claim.
-   **Rule-of-three padding.** "clear, concise, and effective": keep the one word that carries the meaning.
-   **Colon reveals.** "The best part: it learns." Write a sentence. Colons are for lists, labels and quotes.
-   **Fake-depth "-ing" tails.** "...ensuring consistency", "...highlighting the team's commitment". State the concrete consequence or cut the clause.
-   **Importance puffery.** "marks a pivotal moment", "stands as a testament", "plays a vital role". State the fact; the reader judges whether it matters.
-   **Interpretive metadiscourse.** "The key point is", "This matters more than it sounds", "As you can see", redundant "In other words". Delete, or replace with the supporting fact.
-   **Copula avoidance and fake-strong verbs.** "serves as", "boasts", "features", "made a decision", "has the ability to": use is, has, decided, can.
-   **Synonym cycling.** If the clear word is right, repeat it. The agent is the agent, not the assistant, then the tool.
-   **Dramatic fragments and robotic rhythm.** "That's it. That's the whole thing." One short sentence for emphasis is fine; a drumroll is not. Vary sentence length; uniform mid-length cadence is itself a tell.
-   **Filler.** "in order to" is "to", "due to the fact that" is "because", "at this point in time" is "now", "it is important to note that" is deleted. Cut "just", "actually", "honestly", "fundamentally" when they add nothing; keep them when they carry real emphasis or the writer's spoken rhythm.
-   **Fake-profound kickers and recap endings.** Delete the closing aphorism; do not write a better one. Delete "In conclusion" paragraphs. End on the last concrete point or the next action.
-   **Mechanical formatting.** Bold is for labels the eye must find (PASS / FAIL, BEFORE / AFTER), not for emphasis sprinkled through prose. No headers over two-sentence sections, no bullets where two sentences of prose read better, no emoji in headings.
-   **Empty hedging.** Drop "perhaps", "might possibly", "generally speaking" on things you verified. Keep a hedge where the uncertainty is real, and say what exactly is uncertain.
-   **Portability test.** If a sentence could move unchanged to another team, product or company, it is filler. Cut it or replace it with a fact, number, mechanism or judgment specific to this subject.

Voice for anything we post as ourselves: first person ("I checked the query, it returns 15 rows"), never "the user" for yourself. State the observable fact, not the interpretation ("the 4:00pm row is cut off under the tab bar", not "this clearly demonstrates the issue").

## Pre-send check

Delete:

1.  The first sentence, if it announces what is coming.
2.  The last sentence, if it recaps or asks "anything else?".
3.  Any "by the way" sidebar beyond the one allowed tangent.
4.  Any hedge carrying no real uncertainty.
5.  Any remaining em or en dash.

Then run `eval.md` in this folder and fix every fail. Finally, read only the first and last line: does the reader know what to do next and what just happened? If yes, send.
