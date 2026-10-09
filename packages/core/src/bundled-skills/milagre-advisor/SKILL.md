---
name: milagre-advisor
description: Ask a separate analysis-only agent for a second opinion on the current task. Use when asked for an advisor, independent review, another perspective or cross-provider advice in Milagre.
---

# Milagre advisor

Read [the shared advisor contract](../milagre/references/advisors.md).

1. Identify the decision that needs a second opinion. Prepare a self-contained briefing with the problem, evidence/file paths, constraints, your hypothesis and the requested verdict. Include relevant skill references. End with the contract's analysis-only instruction.
2. Call `advisor_providers`. Use an explicit user provider/model/effort choice when supplied; otherwise omit provider to select the other provider. Use only reported model/effort values. If that provider is unavailable, explain the missing installation or Account and continue the main task without silently substituting.
3. Call `create_advisor` with a short title and the briefing. Report the advisor's provider and topic. Continue work that does not depend on the verdict while its analysis runs.
4. When its labeled completion arrives, assess the evidence and synthesize the recommendation, risks and your decision for the user. If it fails or stops, report the incomplete review and preserve the available evidence.
5. Use `advisor_followup` for a consequential clarification, retaining the same ID. Wait for its next completion. Use `advisor_read` only after a notice or for explicit inspection; use `advisor_stop` when the analysis is no longer useful.

The main Chat owns implementation. An advisor cannot edit even when a forwarded skill or the parent's permission mode permits edits.
