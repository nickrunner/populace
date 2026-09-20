# ADR-0010: Run ids and tags

**Status:** accepted (fixed by brief)

## Decision

A run id is `run_<timestamp base36>_<random>` generated when a population is started (or per ad-hoc `wake`). Its tag is `populace:<runId>`. Every identity, wake, finding and trace row stores the run id. Identity providers embed the tag where the target can see it (email `+tag` suffix for self-signup, custom claims for Firebase). `populace sweep --run <id>` calls `IdentityProvider.listByTag` and `teardown` for each identity, then deletes the run rows from the store.


## Amendment (2026-09-18): a sweep keeps the evidence, and never claims a teardown that did not happen

Two parts of "then deletes the run rows from the store" are withdrawn.

**The evidence is kept by default.** `populace sweep` took `--keep-data`, so the bare command
deleted the wakes, traces and findings the run had paid a model to produce — while the dashboard,
calling the same `sweepRun`, defaulted `keepData` to true and kept them. Two defaults pointing in
opposite directions, with the destructive one on the shortest command. Keeping is now the default
on both paths and `--delete-data` is how the user asks for the other thing by name; `--keep-data`
is still accepted, because scripts carry it, and now says what already happens.

**A provider that owns no accounts reports them as pre-existing.** `IdentityProvider` gained
`ownsAccounts`, and `static` sets it false: those logins existed before the run, on somebody's
real product, and deleting them would be destroying another person's data — the no-op teardown
is correct. The reporting was not. A non-throwing no-op counted as `removed++` and logged "tore
down <id>", so the user was told their accounts were gone while they sat there, and the
"evidence is only deleted once every teardown succeeded" guard was vacuous because nothing could
fail. Sweep now tears nothing down for such a provider, leaves `removed` at zero and says
"N identities used pre-existing accounts; populace did not create them and has not removed them."

**A provider that owns accounts it cannot delete says that too.** The same lie had a second way
in, on the DEFAULT strategy: `teardownTool` is optional, `SelfSignupProvider.teardown` returns
immediately without it, and `validate` warns about that configuration rather than refusing it. So
sweep awaited a promise that called nothing, logged "tore down <id>" for every account the
population had signed up for, and dropped the run's rows on a `failures === 0` that again could
not have been anything else — while every one of those accounts was still on the product.
`IdentityProvider.cannotRemove` names the reason, and those identities are now counted apart from
both removals and pre-existing accounts, reported as "N identities could not be removed: <reason>",
and they hold back the `sweptAt` stamp and `--delete-data`, because the run's own rows are the
only remaining record of which accounts were left behind.
