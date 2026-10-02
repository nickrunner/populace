# ADR-0028: Triage is keyed by cluster signature, not by finding id

**Status:** accepted

## Decision

Human state about a problem — triaged, accepted, fixed, won't fix, duplicate, plus a note and an external reference — is stored as `Triage`, keyed by `(projectId, signature)`, where `signature` is a stable content-derived identifier for a cluster: kind, primary tool and normalised title. A finding's state is its cluster's state. The signature function is versioned (`sig1:...`) and changing it requires an explicit mapping step.

## Consequences

A re-run produces new finding rows with new ids in a new run. Keying triage to `finding.id` would detach every recorded judgement the moment someone presses "re-run the people who complained" — breaking the exact screen the feature exists for. Keying to the signature makes "what is new", "what came back after we fixed it" and "what we already decided not to fix" joins rather than heuristics.

It also keeps produced evidence immutable: findings and their reproduction steps are never edited to record an opinion about them.

The risk is signature drift. If clustering (ADR-0017) changes, signatures change and triage detaches, which is why the function is versioned rather than implicit.

## Amendment (2026-09-18): implemented, and measured

**Implemented as specified.** `signatureOf(kind, tool, title)` in `packages/core/src/signature.ts`
returns `sig1:<12 hex>`; every finding carries it as a column, every cluster carries it, and
`triage` is a table keyed `(project_id, signature)` holding state, note, external reference and
`titleAtTriage`. A signature whose current title no longer matches the one it was triaged under is
reported as `drifted` and the finding page says so in words, which is what stops a human's judgement
being carried silently onto a different problem.

The product rests on it in three places: the finding page is `/p/:proj/s/:sim/f/:signature`;
problems the user has marked `fixed` or `wont-fix` collapse into a "Known" section below the fold,
which is what keeps execution 40 readable; and a signature marked `fixed` that is **here again** is
`regressed` and stays at the top, because burying it is exactly the failure triage-by-signature
exists to prevent.

**Measured, and the number is a cliff rather than a curve.**
`packages/reports/src/stability.test.ts` runs the same ephemeral simulation against a fresh mock
target twice — new run id, new tag, new accounts, new task ids, new timestamps — and compares the
signature sets:

| The second execution's wording | Signatures that recur |
| --- | --- |
| Identical | **4 of 4 — 100%** (asserted; a drop here means something per-execution leaked into the key) |
| Same words, different punctuation and filler | **4 of 4 — 100%** (asserted; this is what tokenising the title is for) |
| The same complaints reworded from scratch | **0 of 4 — 0%** |

Zero is not a defect to be tuned away. A signature is a hash of an exact token set, so one different
content word is a different key by construction. The honest reading is that **a signature identifies
a problem across executions exactly as well as the model's wording is stable**: reliable for a
run-it-again against the same build, where the same script produces the same titles, and for triage
within one wording; not reliable enough to declare a repair from an absence.

**So the compare UI states an absence as an absence.** The column is headed *"Not reported in the
later one"* and reads *"An absence, and only an absence. It may be fixed, or it may have been
described in different words this time."* The screen carries a standing caveat that a complaint
worded differently the second time reads as gone and as new at once, and the word **fixed** appears
in the product in exactly one place: the triage control, where a human types it. `stateOfCluster` in
the web app renders the derived `fixed` state as **"not reported"** for the same reason.

Loosening the hash — keying on the tool alone, say — would trade one wrong answer for a worse one:
two unrelated problems on one tool would merge, and a human's triage would land on the wrong thing.
A semantic signature (an embedding, or a judge asked "is this the same problem?") is a later ADR and
is the only thing that actually moves this number.

## Amendment (2026-09-30): the key moves, so the match is an intersection — and populace writes a reference of its own

Two things changed when a problem became something populace files into somebody's issue tracker
(ADR-0044). Neither changes the key this record decided; both change how it is looked up, and one
adds a writer this record assumed did not exist.

**A triage row is matched by signature-set intersection, not on the representative.** This record
keys triage on `(projectId, signature)` and that is unchanged — the row is still one signature and
a human's judgement about it. What was wrong was the *lookup*. A card asked for its triage row by
`ClusterCardView.signature`, which is the **representative** of a clustering, and
`pickRepresentative` (`packages/reports/src/cluster.ts`) sorts on **verdict score first**. Verdicts
are written by the digest, after the run. So the representative moves inside a single execution,
with nobody having reworded anything, and a card looked up by it read **"not triaged" in precisely
the case the row exists for**: the problem whose key flipped after somebody had already declined it.

`cardOf` now intersects the cluster's **member** signatures — the per-finding hashes this record
defined, computed once at file time and never recomputed — against the triage rows, through one
`oldestMatching` shared with the filing ledger, and takes the oldest match. The rolled-up
project-wide triage list still looks up by its own key, because a rolled-up signature is not a
cluster and has no member set to intersect.

**populace may now write an external reference itself, and it does not touch `externalRef`.** This
record's decision names *"an external reference"* among the human state it stores, and that field
stays exactly what it was: whatever a person typed on the triage form, which may be a Jira key, a
pull request or a sentence. populace's own record of an outbound write it made lives in a separate
ledger (`filed_issues`) and reaches a screen as `TriageView.filedIssue` and
`ClusterCardView.filedIssue`, beside `externalRef` and never inside it. A form that treated them as
one field would let a reader's typing erase the link to an issue that exists.

Filing writes **no triage row at all**, which is why `filedIssue` is on the card as well as on
`triage`: manufacturing a judgement nobody typed would make the finding page say a human settled
this minutes ago, and hand `drifted` a `titleAtTriage` no human stood behind. For a problem filed
and never ruled on, `triage` is null and the card is the only place that can say "#41".

**The 0% number in the amendment above is now load-bearing outside this record.** It is what bounds
the dedupe in ADR-0044 §4: the filing ledger and the hidden marker in each issue body are both keyed
on the same hash, so a complaint reworded from scratch gets its own issue, and neither defence can
see through it. That is stated there as the limit rather than dressed up as idempotency, and the
backstop is a human reading an "already filed" column. Nothing here improves the number; a semantic
signature is still the only thing that does.
