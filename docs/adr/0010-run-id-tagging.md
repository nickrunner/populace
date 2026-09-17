# ADR-0010: Run ids and tags

**Status:** accepted (fixed by brief)

## Decision

A run id is `run_<timestamp base36>_<random>` generated when a population is started (or per ad-hoc `wake`). Its tag is `populace:<runId>`. Every identity, wake, finding and trace row stores the run id. Identity providers embed the tag where the target can see it (email `+tag` suffix for self-signup, custom claims for Firebase). `populace sweep --run <id>` calls `IdentityProvider.listByTag` and `teardown` for each identity, then deletes the run rows from the store.

