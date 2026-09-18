# ADR-0027: Long-running operations are persisted jobs

**Status:** accepted

## Decision

Starting a run, running a digest, validating a target and re-running a continuation are all jobs: a row with kind, status, progress, error and timestamps, drained by one in-process runner inside `populace serve`. API calls that trigger them return a job id immediately; progress reaches the browser over the event stream.

## Consequences

These operations are slow and cost money, so the UI has to show progress and survive a page reload — which an in-memory promise cannot do.

In M5 the same table is the queue hosted workers pull from. The interface does not change, which is the point of persisting the job rather than tracking it in the request.
