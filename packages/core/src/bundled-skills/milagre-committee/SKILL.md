---
name: milagre-committee
description: Get two independent analysis-only opinions on a difficult decision, root cause or plan in Milagre, compare the evidence and report unresolved disagreement. Use when asked for a committee or two-agent review.
---

# Milagre committee

Read [the shared advisor contract](../milagre/references/advisors.md).

1. Write one self-contained problem briefing with the decision, evidence/file paths, constraints and requested recommendation. End with the analysis-only instruction. Give both members the same facts and no other member's verdict for their first analysis.
2. Call `advisor_providers` and preflight both members. Default to one Claude and one Codex advisor. Explicit user provider/model choices take precedence; validate them against the reported catalog. If a member is unavailable, explain which member is missing before launching the available member as a partial committee. Do not replace it silently with two copies of the same provider.
3. Call `create_advisor` once per available member with `[Committee]` titles and explicit providers. At most two members run simultaneously. Continue independent work and wait for labeled completions; do not poll.
4. Once both settle, compare their evidence, agreement, disagreement and risks. State your recommendation with reasons. Report a failed/cancelled member as an incomplete committee; keep the surviving result useful.
5. For a consequential disagreement, send each member the competing arguments through `advisor_followup` at most once. After those completions, synthesize again and state any unresolved disagreement. Do not force consensus or repeat the comparison loop.

Committee members have the same enforced access as a single advisor. The main Chat implements the decision.
