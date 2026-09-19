# Architecture Decision Records

One record per fixed decision from the kickoff brief, plus the routine calls made where the brief was silent.

| # | Title |
| --- | --- |
| [0001](0001-typescript-pnpm-monorepo.md) | TypeScript, pnpm workspaces, Node 22, ESM, strict TS, no `any`/`unknown` |
| [0002](0002-zod-for-all-schemas.md) | Zod for every config and persisted schema |
| [0003](0003-wakes-are-stateless-jobs.md) | Agents are never long-lived processes; a wake is a stateless job |
| [0004](0004-local-and-cloud-share-runner.md) | Local and cloud modes share the runner; only Store and Scheduler differ |
| [0005](0005-runner-hosts-mcp-client.md) | The runner hosts its own MCP client and intercepts every tool call |
| [0006](0006-claude-model-calls.md) | Claude via the Anthropic SDK: model, fallbacks, thinking, effort, streaming, caching, history |
| [0007](0007-reporter-toolset.md) | Reporter toolset is the only way findings and memory are produced |
| [0008](0008-persistent-agent-memory.md) | Persistent per-agent memory: notes plus a structured slice |
| [0009](0009-guardrails-in-runner.md) | Guardrails live in the runner, not the prompt |
| [0010](0010-run-id-tagging.md) | Every identity, wake and finding carries a run id; sweep removes by tag |
| [0011](0011-node-sqlite.md) | Local store on `node:sqlite` with no native dependencies |
| [0012](0012-self-signup-capture.md) | Self-signup credentials are captured by intercepting the signup tool |
| [0013](0013-destructive-tool-confirmation.md) | Destructive tools are confirmed by an identical repeat call |
| [0014](0014-verifier-replay-and-judge.md) | Verifier = mechanical replay + judge |
| [0015](0015-finding-evidence-call-refs.md) | Findings reference evidence by call ref; the runner resolves them |
| [0016](0016-scripted-provider-for-tests.md) | A scripted model provider makes wakes deterministic in tests |
| [0017](0017-clustering-heuristic.md) | Clustering by kind, primary tool and title similarity |
| [0018](0018-yaml-config.md) | Configuration is a single YAML file validated by zod |
| [0019](0019-in-process-scheduler.md) | Scheduler interface and the in-process cadence loop |
| [0020](0020-run-lineage-and-continuations.md) | Memory is run-scoped, and runs form a lineage (`--continue-from`) |
| [0021](0021-web-app-packages-and-stack.md) | Web app packages and stack: Hono API, React/Vite dashboard, shared contract |
| [0022](0022-serve-owns-the-store.md) | `populace serve` is one process and owns the store |
| [0023](0023-http-api-contract.md) | REST API under a zod contract, loopback by default |
| [0024](0024-runs-are-first-class.md) | Runs are first-class and carry a frozen config snapshot |
| [0025](0025-config-source-of-truth.md) | The store becomes the source of truth for configuration at M2 |
| [0026](0026-sse-event-log.md) | Live updates over SSE, backed by a persisted event log |
| [0027](0027-persisted-jobs.md) | Long-running operations are persisted jobs |
| [0028](0028-triage-keyed-by-cluster-signature.md) | Triage is keyed by cluster signature, not by finding id |
| [0029](0029-project-simulation-population-cohort-person.md) | Project, simulation, population, cohort, person |
| [0030](0030-ephemeral-is-a-clean-slate.md) | Ephemeral is a clean slate, not a repeatable result |
| [0031](0031-people-are-written-once-and-stored.md) | People are written once and stored |
| [0032](0032-translate-at-the-contract-boundary.md) | Translate at the contract boundary; do not rename internal nouns |
