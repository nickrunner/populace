# ADR-0014: Verifier = mechanical replay + judge

**Status:** accepted

## Decision

Verification of a finding has two halves:

1. **Replay.** A second agent connects to the target with the finding identity (or a fresh self-signup identity if the original cannot be reused) and replays the reproduction steps in order with the same arguments, recording each replayed result. This is deterministic code, not a model.
2. **Judge.** Given the finding, the original results and the replayed results, a judge returns `confirmed`, `not-reproduced` or `inconclusive` with a reason. The default judge is a model call with a strict `verdict` tool. A heuristic judge compares error flags and normalised result shapes and is used in CI and offline.

`inconclusive` is returned when the target is unreachable, a step fails before the step the finding points at, or the judge is unsure. Verification results are stored with the finding and shown in the digest.

## Amendment (M2, 2026-09-18): replay mutates the target, and M3 has to decide what to do about it

Replay is not read-only. It re-issues the finding's reproduction steps against the live target with
the same arguments, and those steps include writes. Two consequences that were not thought through
when this was written:

1. **A finding filed with no `evidence_calls` gets the visit's last five tool calls instead.**
   `resolveEvidence` falls back to `callLog.slice(-5)` when the model names no refs or names refs
   that do not resolve, and the reporter tool's own description tells the model that empty "means
   the last few calls". Those five were never chosen as evidence, so replaying them re-issues writes
   that have nothing to do with the finding: creating projects, editing tasks, deleting things. Every
   later replay in the same pass then sees a target that earlier replays changed.
2. **Verification order decides the outcome.** M2 found this as an intermittent test: `listFindings`
   ordered by `created_at` alone, which is not a total order for findings filed in the same
   millisecond, so a tie broken differently changed what the next replay saw. Ordering by
   `(created_at, rowid)` makes it insertion order, which makes the contamination reproducible rather
   than absent.

This matters most for fix validation (M3), which is built on verdicts: a verdict that depended on
what an earlier replay wrote is not evidence that a fix worked. The options, none of them chosen
yet, are to replay each finding against a fresh identity, to narrow or drop the `slice(-5)` fallback
so a finding without evidence is judged inconclusive rather than replayed on calls nobody chose, to
snapshot and reset the target between replays where it exposes a way to, or to mark a verdict as
contaminated when a prior replay in the same pass wrote. **Open for M3.**

## Amendment (2026-09-30): replay is deliberately not part of the recurring loop

ADR-0045 gave a longitudinal study a repeating report cycle: every so often it digests what has been
reported since the last window and files or comments on it (ADR-0044). The obvious thing to put in
that loop is a **functional** re-check — replay the recorded calls and see whether the problem is
still there — and it is free of model spend, because `heuristicJudge` costs nothing. **It was
considered and refused**, and this is the record of why, so the question is not re-opened without
the prerequisite being dealt with first.

Three reasons, all of them consequences of the amendment above rather than new findings:

1. **Replay writes.** It re-issues stored arguments verbatim, and reproduction steps include
   creates, edits and deletes. The amendment above lists this as unsettled and
   `WEB-ARCHITECTURE.md` says it must be settled before R1. A *recurring* loop compounds it: the
   target drifts further with every pass, so the thing being measured is changed by the act of
   measuring it, on a schedule, for as long as the study runs. That is worse than a contaminated
   verdict — it is a contaminated **product**, and the study's own findings after the first few
   cycles would be about damage populace did.
2. **It would replay calls nobody chose.** The `slice(-5)` fallback stands: a finding filed with no
   `evidence_calls` gets the visit's last five tool calls, and `give_up` routinely names none. So a
   recurring functional check on such a finding re-issues five arbitrary writes unrelated to the
   problem, every cycle, for ever.
3. **A verdict is sticky, so a re-check would mostly do nothing anyway.** `verifyPending` takes
   `unverifiedOnly: true` and there is no API to clear a verdict, so a second pass over the same
   finding is a no-op. That is convenient here rather than limiting — each cycle verifies only what
   was filed since the last one, which is what keeps a recurring cycle cheap — but it means "re-check
   it every hour" is not a thing the current code can do even if the first two reasons went away.

**So the loop uses reach, not replay:** who hit the problem, who is still visiting, how many visits
they have made since it was last reported, and who walked away over it and has therefore passed no
judgement (ADR-0045 §6). That is evidence populace already has, it costs nothing, and it writes
nothing to anybody's product.

**The prerequisite, named so it is not guessed at later: narrow or drop the `slice(-5)` evidence
fallback** in `packages/runner/src/wake.ts`, so a finding that named no evidence is judged
inconclusive rather than replayed on calls nobody chose. That is the smallest change that makes
replay safe enough to consider putting on a schedule, and it is the one of this record's four open
options that has to come first — replaying against a fresh identity, resetting the target between
replays and marking a verdict contaminated all still leave the arbitrary-writes case intact. Until
it is done, a functional check belongs to a human pressing something, once, and not to a loop.
