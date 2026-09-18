# ADR-0028: Triage is keyed by cluster signature, not by finding id

**Status:** accepted

## Decision

Human state about a problem — triaged, accepted, fixed, won't fix, duplicate, plus a note and an external reference — is stored as `Triage`, keyed by `(projectId, signature)`, where `signature` is a stable content-derived identifier for a cluster: kind, primary tool and normalised title. A finding's state is its cluster's state. The signature function is versioned (`sig1:...`) and changing it requires an explicit mapping step.

## Consequences

A re-run produces new finding rows with new ids in a new run. Keying triage to `finding.id` would detach every recorded judgement the moment someone presses "re-run the people who complained" — breaking the exact screen the feature exists for. Keying to the signature makes "what is new", "what came back after we fixed it" and "what we already decided not to fix" joins rather than heuristics.

It also keeps produced evidence immutable: findings and their reproduction steps are never edited to record an opinion about them.

The risk is signature drift. If clustering (ADR-0017) changes, signatures change and triage detaches, which is why the function is versioned rather than implicit.
