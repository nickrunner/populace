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
