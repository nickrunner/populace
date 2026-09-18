# ADR-0029: Config history is a revision log of the authored document, and YAML is a redacted exchange format

**Status:** accepted 2026-09-18 (M2, second slice). Implements the versioning and export halves of ADR-0025.

## Decision

Every write to the authored tables (targets, personas, population, settings) goes through one wrapper,
`withRevision`, which captures the whole authored document before and after the change and appends a row
to `config_revisions`: `(id, projectId, at, summary, source, document)`. The document is the complete
authored state, not a diff, and `source` is one of `editor`, `import`, `restore`, `baseline`. The first
write into a project with no history writes a `baseline` revision first, so the state a project was in
before the dashboard touched it is always recoverable. The log is pruned to the last fifty revisions per
project.

Restoring is the same operation in reverse: `applyAuthored` replaces the authored rows with the ones in
the revision and writes a further revision recording that it did. Restoring is refused while a run is
going, because a run's own frozen snapshot (ADR-0024) is what the run consumes and swapping authored rows
underneath it would make the dashboard describe a run it is not driving.

Revisions carry credentials in the clear. They live in the same database file as the `targets` table they
were copied from, so they add no exposure that the authored rows do not already have, and a revision with
its bearer token stripped could not be restored into a working config — which is the only reason to keep
one. Redaction is a property of frozen snapshots, which leave the database (ADR-0024), not of this log.

Export and import are the same `PopulaceConfig` zod schema the CLI parses and the runner consumes, so the
round trip is a serialisation rather than a translation. Export replaces every credential with a `${VAR}`
placeholder naming the variable that supplies it, double-quoted so an unset variable parses as the empty
string rather than as null. Import substitutes the environment, reports the variables it could not
supply, and treats an absent or empty credential as "keep the one already stored" rather than "clear it" —
that is what an exported file looks like on a machine without the secrets, and it is the only reading that
makes export-edit-import safe. A `persona: other-file.yaml` reference is rejected with an explanation
rather than silently dropping a person, because there is no directory on the browser's side of the wire.

## Consequences

A revision is a whole document, so the log is larger than a diff log would be and fifty of them is an
arbitrary ceiling. It buys an important property: restoring never has to replay a chain, so a corrupt or
missing intermediate revision cannot make an older one unrestorable.

Because every authored write goes through `withRevision`, a new authored table is only in the history if
`captureAuthored` and `applyAuthored` learn about it. That is the one place to change, and the compiler
does not enforce it.

Substitution runs over the whole file, comments included. The export header therefore names variables
bare (`POPULACE_TASKLET_TOKEN`) and never as `${...}`; writing a placeholder in a comment would report it
to the reader as a dependency and, on a machine where it is set, would write the secret's value into the
comment.
