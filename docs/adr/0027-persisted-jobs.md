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
