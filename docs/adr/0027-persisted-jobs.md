# ADR-0027: Long-running operations are persisted jobs

**Status:** accepted

## Decision

Starting a run, running a digest, validating a target and re-running a continuation are all jobs: a row with kind, status, progress, error and timestamps, drained by one in-process runner inside `populace serve`. API calls that trigger them return a job id immediately; progress reaches the browser over the event stream.

## Consequences

These operations are slow and cost money, so the UI has to show progress and survive a page reload — which an in-memory promise cannot do.

In M5 the same table is the queue hosted workers pull from. The interface does not change, which is the point of persisting the job rather than tracking it in the request.

## Amendment (2026-09-18): a serial queue, a settled job, and a dead process

The queue is drained **serially**, which is right at this size and has one consequence worth
knowing: starting an execution answers with a run id, and the route gets that id by waiting for the
enqueued job to reach the point where the run row exists. A long job already in the queue therefore
delays the answer to a request that has nothing to do with it. The wait is bounded — after fifteen
seconds the route answers "the run is taking longer than expected to start; watch the job for
progress" rather than holding the connection, and a job that failed in the meantime is reported as
the conflict it is.

A settled job never changes again. `run.start` outlives its own handler — the handler returns once
the run row exists and the daemon keeps ticking behind it — so its progress callback goes on firing
long after the job succeeded. Writing those would leave a finished job with a moving progress count
and put a line on the live feed once per visit. Progress after the fact belongs to the run, which
has its own events.

A job left `running` or `queued` by a process that died is failed on the next open: it can never
finish, and a browser would otherwise wait on its spinner forever.

The run that job was driving is reconciled on the same open and **to a different state** — `paused`
with `pauseReason: "process-ended"`, not `failed` (ADR-0024 amendment). That asymmetry is
deliberate rather than an oversight: the job really did stop and cannot be picked up, while the
execution is exactly what `serve --resume` picks back up.

## Amendment (2026-09-30): two kinds for filing, and the first jobs with no request behind them

Filing a study's problems into an issue tracker (ADR-0044) added `issues.publish` and
`issues.cycle` to `JobKindSchema`. No store change: `jobs.kind` is `TEXT`. `run.round` was left
alone although it is an unused slot — `RunController.round()` already means "make every active
person visit now", which is a different thing.

**`issues.cycle` is enqueued from `drive()` and from `onWake`, not from a route, and they are the
first jobs in the system with no request behind them.** Everything this record was written for is
somebody pressing something: a job answers a call, and the call gets an id back. A report cycle is
enqueued because a window closed — so many visits or so long since the last one — and the terminal
report is enqueued because a run reached `completed`. Nobody is waiting on either, and there is no
connection to answer.

Three consequences follow, and all three are about the queue this amendment's predecessor
described.

- **A cycle skips rather than stacks.** The queue is a strictly serial FIFO with no delay, no
  recurrence and no cancellation, so a cycle enqueued while the previous one is still in flight
  would sit in front of every sweep, target check and run start behind it — to do work that has not
  changed in the meantime. The trigger checks whether a cycle is outstanding and declines. A
  recurring job is not what this table is; skipping is how a recurring caller lives on it.
- **The enqueue is detached and may not throw.** `stop()` and `shutdown()` both await `drive()`, so
  awaiting a publish to forty issues would stall a stop request and the process exit, and a throw
  escaping `drive()` rejects that promise and arrives at the dashboard as a 500 on stop. Both hooks
  copy `autoSweep`'s try/catch/log shape, and the dropped promise's rejection is still taken, or a
  failed report becomes an unhandled rejection that can end the process.
- **A failure has no reader.** A route's caller sees a failed job; nothing sees these. So the
  preconditions that can be checked cheaply — is there a repository, has anybody asked for
  automatic filing, did anybody visit — are checked **before** enqueueing, because "you have not
  connected a repository" as one failed job per execution on a live feed for the life of a study is
  noise that teaches nothing.

**And one kind means something the other does not.** A succeeded `issues.cycle` with an `endedAt`
is what closes a report window (ADR-0045 §3); `issues.publish` closes nothing. Read off one shared
kind, a human's bulk press advanced the state machine and made the next cycle comment "gone quiet"
on every issue in the repository. A job kind is not only a label here — it is a fact the arithmetic
reads — which is worth knowing before anybody merges two of them to tidy the enum.

`packages/web/src/screens/LiveRun.tsx` switched on kind in an untyped ternary whose fallback
labelled every unknown kind "Starting the execution did not finish". It is a map keyed by kind now.
No exhaustive `switch` on `JobKind` exists anywhere, so the compiler finds no such site: adding a
kind means grepping for the ones that read `job.kind` as copy.
