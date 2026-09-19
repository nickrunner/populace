# populace

A synthetic user population harness. populace deploys a scalable population of
AI agents, each seeded with a persona, against any application that exposes a
rich MCP server. The agents behave like real prospective users: they discover
the app through its tools, decide whether it is for them, sign up, use it, and
come back on a schedule. What they produce is structured findings, verified,
deduplicated and clustered into a digest for a product team: bugs with
reproductions, friction, coverage gaps in the MCP surface, suggestions,
abandonment.

Nothing in this repository depends on an external service to develop or test.
A reference app with planted defects (`packages/mock-target`) is the target for
development and CI.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the map and
[docs/adr/](docs/adr/README.md) for every design decision.

## Five-minute quickstart against the mock target

Requirements: Node 22.13+, pnpm 10, an Anthropic API key.

```bash
pnpm install
pnpm build

# 1. Start the reference app (Tasklet) in one terminal.
pnpm mock-target --port 4310

# 2. In another terminal, create a config and check it against the running target.
export ANTHROPIC_API_KEY=sk-ant-...
pnpm populace init            # writes populace.yaml: three cohorts, mock target, self-signup
pnpm populace validate        # parses the config, connects, lists the 19 tools

# 3. Run one wake for one persona right now and watch the trace summary.
pnpm populace wake casual-lister

# 4. Run the population on a short cadence (2 minutes by default in the template).
pnpm populace run             # Ctrl-C to stop; agents retire after maxWakes

# 5. Verify, cluster and render the digest for the last 24 hours.
pnpm populace digest          # writes digests/<date>-<id>.md (and .json)

# 6. Remove every account the run created on the target and the run's data.
pnpm populace sweep
```

`populace serve` opens the dashboard, which is the other way in: point it at an MCP
endpoint, pick who visits, say how many of each, and press go. Everything below has
a screen there.

`populace run --continue-from <run id>` starts a new run that inherits the previous
one's agents, memory and accounts, so you can ship a fix and see whether the users
who complained are satisfied by it. Agents who gave up return only if they said
they would; the rest stay gone, and both runs stay separately reportable so their
digests can be compared (ADR-0020).

`populace status` shows agents, wakes, findings and spend; `populace kill`
engages a global kill switch that stops every wake at its next step
(`populace kill --release` lifts it); `populace scale 2` doubles every cohort.

The digest for the mock target should list the four planted defects documented
in [packages/mock-target/README.md](packages/mock-target/README.md): three bugs
with reproductions and one missing tool reported as a coverage gap.

Every command takes `-c <file>` for a different config and `-r <run id>` to act
on a specific run. The example config lives in
[examples/tasklet-population.yaml](examples/tasklet-population.yaml).

## Pointing it at your own app

Edit `populace.yaml`:

- `target.mcp[]`: one or more Streamable HTTP endpoints, with an optional static
  bearer token per endpoint and an optional `webBaseUrl` the agent may read pages from.
- `identity`: `self-signup` (the agent signs up through your tools; name the
  signup tool and where the token is in its result), `static` (a credentials
  file), or `admin-mint` (Firebase Admin custom tokens; install `firebase-admin`).
- `cohorts[]`: "N people on one persona" — a slug, a `size`, and optional `seed`,
  `cadence` and `maxWakes` overrides. **There is no scale factor: `size` is the only
  number that decides how many people exist.** Two cohorts may share one persona, which
  is how "twelve first-timers every ten minutes" and "eight first-timers on mobile
  every four" become two different groups. A persona can be inline or
  `persona: ./file.yaml`, and may set `model: { model, effort, maxTokens }` to override
  the global `model` block, so one population can mix cheap and capable agents.
- `population`: composition and nothing else — a name and the cohorts in it.
- `simulations[]`: a population against a target, in one of two modes.
  `visitsPerPerson: 4` is **ephemeral** — a clean slate every time it is run, bounded,
  ending on its own when the last person hits the cap. `visitsPerPerson: null` is
  **longitudinal** — memory, accounts and visit counts accumulate, and it runs until
  you pause it. Outcomes vary between executions by design; the mode is about history
  and termination, not repeatability (ADR-0030).
- `verifier.model`: the judge's own model. It decides what reaches the digest, so
  it defaults to a stronger model and effort than the agents it judges.
- `guardrails`: per-wake token and dollar ceilings, a per-population daily
  ceiling, per-persona tool allow/deny lists and a destructive-tool policy.

Then `populace validate` and `populace wake <persona>`.

## Repository layout

| Package | What |
| --- | --- |
| `packages/core` | Vocabulary types and zod schemas; Store, Scheduler, IdentityProvider interfaces; run ids and tags; population expansion; pricing |
| `packages/runner` | The wake loop, MCP client with interception, reporter toolset, memory, guardrails, trace writer, Anthropic model provider, local daemon |
| `packages/adapters` | Identity providers: `@populace/adapters/self-signup`, `/static`, `/firebase-admin` |
| `packages/store-sqlite` | Store on `node:sqlite` |
| `packages/reports` | Verifier (replay + judge), clustering, Markdown digest, exporter plugin interface |
| `packages/cli` | `populace init | validate | wake | run | scale | digest | sweep | kill | status | serve` |
| `packages/mock-target` | Tasklet, the reference app with an MCP server, self-signup and planted defects |
| `examples/` | A three-cohort population for the mock target |

## Development

```bash
pnpm check          # build + lint + typecheck + test, what CI runs
pnpm test:watch
```

Tests run wakes against the mock target with a scripted model provider, so the
whole pipeline (trace, memory, identities, findings, verification, clustering,
digest, sweep) is exercised without an API key. Live model runs need
`ANTHROPIC_API_KEY`.

## Vocabulary

The product says project, target, persona, cohort, person, population, simulation,
execution and visit. The code says Target, IdentityProvider, Persona, Cohort, Person,
Population, Simulation, Run, Agent, Wake, Trace, Finding, Digest, Runner, Scheduler,
Store — an `Agent` is a participant and a `Wake` is a visit, translated at the HTTP
contract and nowhere else (ADR-0032). Definitions in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#vocabulary); the entity model is
[ADR-0029](docs/adr/0029-project-simulation-population-cohort-person.md).

## License

MIT
