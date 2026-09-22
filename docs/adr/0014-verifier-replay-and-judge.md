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
