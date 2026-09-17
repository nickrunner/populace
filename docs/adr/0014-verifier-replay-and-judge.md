# ADR-0014: Verifier = mechanical replay + judge

**Status:** accepted

## Decision

Verification of a finding has two halves:

1. **Replay.** A second agent connects to the target with the finding identity (or a fresh self-signup identity if the original cannot be reused) and replays the reproduction steps in order with the same arguments, recording each replayed result. This is deterministic code, not a model.
2. **Judge.** Given the finding, the original results and the replayed results, a judge returns `confirmed`, `not-reproduced` or `inconclusive` with a reason. The default judge is a model call with a strict `verdict` tool. A heuristic judge compares error flags and normalised result shapes and is used in CI and offline.

`inconclusive` is returned when the target is unreachable, a step fails before the step the finding points at, or the judge is unsure. Verification results are stored with the finding and shown in the digest.

