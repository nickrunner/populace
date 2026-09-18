# ADR-0027: Long-running operations are persisted jobs

**Status:** accepted

## Decision

Starting a run, running a digest, validating a target and re-running a continuation are all jobs: a row with kind, status, progress, error and timestamps, drained by one in-process runner inside `populace serve`. API calls that trigger them return a job id immediately; progress reaches the browser over the event stream.

## Consequences

These operations are slow and cost money, so the UI has to show progress and survive a page reload — which an in-memory promise cannot do.

In M5 the same table is the queue hosted workers pull from. The interface does not change, which is the point of persisting the job rather than tracking it in the request.

## Amendment (M2, 2026-09-18)

The queue is drained **serially**, which is right at this size and has one consequence worth
knowing: `POST /runs` waits for its job to reach the point where the run row exists before it can
answer with a run id, so a long job already in the queue delays the answer to a request that has
nothing to do with it.

A settled job never changes again. `run.start` outlives its own handler — the handler returns once
the run row exists and the daemon keeps ticking behind it — so its progress callback goes on firing
long after the job succeeded. Writing those would leave a finished job with a moving progress count
and put a line on the live feed once per visit. Progress after the fact belongs to the run, which
has its own events.

A job left `running` or `queued` by a process that died is failed on the next open, along with the
run it was driving.
