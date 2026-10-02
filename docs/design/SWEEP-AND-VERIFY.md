# Auto-sweep destroys the thing that makes a finding true

**Status:** a decision for the owner, not a decision taken. The two defects around it are fixed;
the ordering below is not.

## What happened

A reader ran a simulation against Stays Dev, stopped it, and pressed **Re-check them** on 31
findings. All 31 came back:

```
inconclusive — could not connect: Streamable HTTP error:
Error POSTing to endpoint: {"error":"Missing bearer token"}
```

They read that as an auth problem, and reasonably: it is the sentence a misconfigured sign-in
produces. It was not one. The run had `autoSweep: true`:

| | |
| --- | --- |
| Run ended | `02:49:13.150Z` |
| Accounts torn down | `02:49:14.104Z` → `02:49:24.242Z` |
| Accounts still alive when Re-check ran, 38 minutes later | **0 of 22** |

Every account was deleted one second after the run stopped. `replayFinding` refuses a torn-down
identity — replaying as a deleted account would be a lie — so it connected with no credential at
all, and an OAuth-protected target said what such a target says.

## What is now fixed

**The refusal names the cause, and happens before the connection.** A finding that names an
identity which is gone or torn down is refused in `replayFinding` before a session is opened, with
a sentence that says the account was removed by a sweep, when, and what to do about it. Previously
the product opened one doomed connection per finding — 31 requests against somebody else's
product — to be told something it already knew.

A finding that names *no* identity still replays anonymously: on a target whose people have no
accounts (ADR-0038), anonymous is how the report was filed in the first place.

The model judge was already skipped on a failed replay, which is why this cost nothing. That was
luck of ordering rather than design, and it is worth keeping deliberately.

## The decision that is left

**A run that sweeps on completion has destroyed its own verifiability, and nothing says so.**

`autoSweep` defaults to **true** for an ephemeral simulation (`SimulationSchema`), and an ephemeral
run is exactly the kind you would digest. So the default path is: run, sweep, then discover that
every claim is permanently unverifiable. Re-running does not recover *these* findings — the
accounts that filed them are gone, and a freshly provisioned user is not the one who hit it.

Four ways out, and they trade different things:

1. **Verify before sweeping.** The run controller already knows it is about to sweep; it could
   verify pending findings first. Costs model money automatically at the end of every ephemeral
   run, which is the sort of spend that should be asked for rather than assumed.
2. **Delay the sweep.** Keep the accounts until a digest has been read, or for a fixed window.
   Leaves test users on somebody's product for longer, which is the thing auto-sweep exists to
   avoid — and on a product with real users, the longer they sit, the worse.
3. **Default `autoSweep` to false and say why.** Honest, and makes the trade visible at the moment
   somebody chooses it. Costs: accounts accumulate on the target for anyone who never sweeps.
4. **Say it at the point of the choice and change nothing else.** The simulation editor states
   that turning auto-sweep on means findings stay claims. Cheapest, and relies on reading.

My recommendation is **(4) now and (1) behind a toggle later** — the ordering is right in (1), but
making a run spend model money on its own is a bigger decision than this bug, and it belongs to
whoever pays the bill.

## What is knowingly still wrong

- **Nothing warns before the spend.** Re-check is happy to engage a model judge for findings it
  can already tell it cannot replay. It skips the judge per finding, but it could refuse the whole
  action with a sentence rather than producing 31 inconclusive verdicts.
- **`autoSweep` has two defaults** — `false` on `SimulationContextSchema`, `true` on
  `SimulationSchema`. Whichever is right, two of them is one too many.
- **An inconclusive verdict is sticky.** Once written, a finding is no longer pending, so a later
  re-check does not revisit it without clearing the verdict first.

## Amendment (2026-09-30): filing issues raised the price of both open items

Two things on this page stopped being local bugs when a study started filing its problems into
somebody's issue tracker (ADR-0044).

**"A run that sweeps on completion has destroyed its own verifiability" now destroys the
verifiability of things that have left the building.** The sweep passes `keepData: true`, so the
findings survive and publishing works — but `replayFinding` refuses outright once an identity is
torn down, so a **digest** that runs after it returns "the account that filed this was removed" for
everything. Before, that meant a digest somebody read and could re-run against a fresh execution.
Now it means an issue in somebody's repository whose body says nothing was checked, which nobody can
go back and check later because the accounts are gone.

**The sweep is a job now, which is option (1) reordered properly and is what shipped.** `drive()`
offers the terminal report the teardown; when the report takes it, `reportIssuesWith` enqueues it
**third** on the strictly serial FIFO, behind the digest and the filing. So the order is
verify → publish → sweep, structurally, on a queue with no cancellation — not "enqueued before the
sweep", which was never the same thing as running before it: the report only *queued* a digest, and
a sweep on the next line tore the accounts down while that digest was still draining, so whether a
verdict read the product or said the account was removed came down to which pass got there first.
`drive()` sweeps inline only where the report declined the teardown — no reporter, filing not armed,
nobody visited, or the report threw — and the loud warning

> *WARNING: this study files issues automatically AND removes its accounts when it finishes. They go
> now, so nothing filed from this execution can be checked against the target again. Turn auto-sweep
> off for a study that files issues.*

survives for exactly that declining path. On the ordinary path the run logs instead that the accounts
are queued for removal behind the report, so what was found is checked first and cannot be checked
again afterwards.

**Two gaps are left, and they are smaller and different.** The study is still **not refused**: the
accounts do go, so nothing filed from that execution can ever be re-checked — a later digest, a
manual re-check or a `--continue-from` execution all get the same sentence. And the move off
`drive()` has its own price: a process that exits between the report and the sweep leaves the
accounts on the target, where before they went inside `drive()`, which `shutdown()` waits for.
`jobs.reconcileOrphans()` fails the row on the next start and `sweptAt` stays null, so the execution
is still discoverable as unswept and `populace sweep` still removes them.

**And `autoSweep`'s two defaults now decide something.** The note below stands —
`false` on `SimulationContextSchema` (`packages/core/src/schemas/simulation.ts:79`), `true` on
`SimulationSchema` (`:137`) — and what was an untidy pair is now the switch that decides whether an
ephemeral study's issues can ever be checked again. **Which one applies is a matter of path:** a
saved study resolves its context off the row (`contextOf`), so an ephemeral study made in the
dashboard sweeps by default, while the context's `false` is what a hand-built or YAML config that
has never heard of studies gets — `config-store.ts` copies the flag up only for a named study,
precisely so such a config cannot silently delete accounts. So the default that an ephemeral study
filing issues actually runs under is **true**. Whichever is right, two is one too many.

**The "nothing warns before the spend" item is settled by making the spend opt-in.** ADR-0045's
report cycle runs a digest on a clock for as long as a study runs, and `VerifierConfigSchema` used
to default to `judge: "model"` with `claude-opus-5` at `effort: "high"` and `maxFindings: 50` — the
most expensive model in the table, at high effort, regardless of what the population itself ran. So
arming a cycle on default config committed to that bill for ever, unattended, and nothing refused
it. The default is now `judge: "heuristic"`: a cycle spends nothing unless somebody raises it, which
is the right shape for the problem, because what was wrong was never the price of a judge a person
asked for — it was paying it on a clock by default. `judge: "model"` now resolves
`claude-opus-5-5` at `effort: "high"`, pinned rather than inherited from `DEFAULT_MODEL`, since the
agents' own default is a Sonnet at `low` and a judge inheriting that would be weaker than the thing
it judges.

**What this does not fix:** the project's daily ceiling is still read before anything is spent and
still bounds the damage per day and not per study, so a `model` or `typesafe` judge deliberately
armed on a repeating cycle is a standing bill with no per-study limit. That part of the item stands.
The typed judge's cheapness is a **published price** ($0.042 per million input tokens, output free)
over a **measured request** (`packages/reports/src/stability.test.ts` prints the worst of five real
findings: ~1,705 tokens for the whole request, ~957 of them state, against a 32k-token cap) — nobody
has paid a month of cycles to check the total, and its two thresholds are not yet calibrated, which
is why `typesafe` is not the default either.
