# ADR-0024: Runs are first-class and carry a frozen config snapshot

**Status:** accepted

## Decision

A run becomes an entity with a label, status, lineage and totals, and it points at a `ConfigSnapshot`: the resolved `PopulaceConfig` serialised once when the run starts, immutable thereafter, content-hashed so identical snapshots dedupe. Secrets are redacted to a reference — the snapshot records that an env var was used, never its value.

M1 does not store this. The roadmap holds M1 to no new persisted data, and everything but label, status and the snapshot is derivable from `agents`, `wakes` and `findings`. M1 ships a `RunSummary` read model behind a query interface; M2 puts the table underneath it without changing a screen.

## Consequences

Config that lives in rows and can be edited would otherwise rewrite history: editing a persona would change what a past run was. The snapshot is what stops that, and it is what lets a continuation say "same population, target repaired" instead of asking the user to remember.

Until M2 the derived model aggregates on every request and cannot tell a run that finished from a run whose daemon was killed. Both are acceptable for a read-only local dashboard and neither survives the browser being able to start runs, which is why the table lands in the same milestone that adds the button.

## Amendment (2026-09-18): a run is an execution of a simulation, and `paused` is not terminal

Three changes, each forced by the entity model (ADR-0029) or by a longitudinal simulation meeting a
laptop (ADR-0030).

**A run belongs to a simulation and carries `seq`.** `runs` gains `simulation_id` and `seq`, with an
index on `(simulation_id, seq)`, so "execution 7" is a number a user recognises rather than a run id
they do not. The row also carries `project_id`, which is what lets run reads stay flat: a run id is
globally unique and the row says which project and simulation own it, so a bookmarked `/runs/:id`
resolves to the simulation page that replaced it without walking every project.

**`paused` is no longer terminal.** It was a settled end state; it is now the resting state of a
longitudinal execution, and the row carries `pauseReason` (`user`, `process-ended`, `kill-switch`),
`resumes` and `lastResumedAt` to say which resting state it is in. `resume` rebuilds a daemon on the
same run id from the frozen snapshot.

**A run whose process died is `paused`, not `failed`.** `reconcileOrphans()` marked every
`running`/`pending` run `failed` on open, which is a lie about a laptop that was closed: nothing
threw and nothing was lost. It now marks them `paused` with `pauseReason: "process-ended"`, and
`serve --resume` re-arms exactly those. `failed` is reserved for a run that actually threw. The live
screen says *"stopped when populace was last closed — pick it back up"* rather than "failed", which
is the whole reason the reason code is on the wire.

**The agent key changed with it.** `agents` is `PRIMARY KEY (run_id, id)`, because agent ids are
deterministic within a run and repeat across them by design (ADR-0029). Keyed on `id` alone,
`--new-run` mutated the previous run's rows instead of creating new ones — the defect ADR-0020
documents — and two executions of one simulation could not coexist at all. `getAgent` and
`listDueAgents` take a run id, which is the compiler-visible form of the fix.

**Applying a change to a running execution** is now explicit rather than impossible. A snapshot is
still immutable; "apply changes" re-resolves the simulation's config, writes a *new* snapshot, sets
`configSnapshotId` on the run, appends a `run.config` event and reconciles. Added cohorts get fresh
participants at visit one, removed cohorts retire as `scaled-down`, everybody else keeps their
memory. The snapshot is still what stops an edit rewriting history; what changed is that replacing
it is an action with a record, not a side effect.

## Amendment (2026-09-18): the snapshot is a record of what ran, never a source of credentials

Two properties of the snapshot that are easy to lose later.

The hash is taken over the **redacted** config with object keys ordered (`snapshotConfig` in
`packages/server/src/config-store.ts`), so it is a hash of content rather than of assembly order and
two runs on unchanged config share one row.

Because the stored config is redacted, anything that opens a connection — a resume, the verifier's
replay, sweep's teardown calls — has to take the plan from the snapshot and the secrets from the
authored rows. That is what `withLiveSecrets` is for. Connecting from a snapshot directly sends
`[redacted]` as a bearer token, and the failure is silent in the worst way: replays that cannot
authenticate come back `not-reproduced`, the digest drops not-reproduced findings before clustering,
and real findings disappear with nothing on screen to say why.
