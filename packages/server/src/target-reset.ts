import type { JsonObject, PopulaceConfig, Store, TargetReset } from "@populace/core";
import { McpSession } from "@populace/runner";

/**
 * Putting the target back to a known state before an ephemeral execution's first visit (SPEC §4.2).
 *
 * This is not a determinism mechanism. populace already gives an ephemeral execution fresh people,
 * fresh memory and fresh accounts by itself; the target's own database is the one thing outside its
 * reach, and `reset` is the only hook that can reach it. Where a target declares none, ephemeral
 * means fresh people and accounts only — which is what the outcome below says in so many words,
 * rather than failing and rather than pretending.
 */
export interface TargetResetOutcome {
  kind: TargetReset["kind"];
  /** False for `kind: "none"` — nothing was called, and the run is told why. */
  applied: boolean;
  ok: boolean;
  detail: string;
}

/**
 * Where the record of a reset is filed. A reset before an execution belongs to that run; one a
 * user asked for by hand belongs to no run at all, and saying so with `runId: null` plus the
 * project is what keeps it on `GET /events?project=…` instead of on nobody's stream.
 */
export interface ResetScope {
  runId?: string | null;
  projectId?: string;
  simulationId?: string;
}

/**
 * Dispatches the three reset kinds and records what happened as a `run.status` event, so the run
 * screen can say "the target was reset" or "it was not, and here is what that means".
 *
 * A reset that fails does not stop the run: the failure is recorded and named. An execution that
 * cannot start because the target was not fresh is what `requireFreshTarget` is for, and it is
 * checked before anything is started, not here.
 */
export async function resetTarget(store: Store, config: PopulaceConfig, scope: ResetScope): Promise<TargetResetOutcome> {
  const outcome = await apply(config, config.target.reset);
  await store.appendEvent({
    runId: scope.runId ?? null,
    wakeId: null,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    ...(scope.simulationId === undefined ? {} : { simulationId: scope.simulationId }),
    type: "run.status",
    payload: { action: "reset", kind: outcome.kind, applied: outcome.applied, ok: outcome.ok, detail: outcome.detail },
  });
  return outcome;
}

async function apply(config: PopulaceConfig, reset: TargetReset): Promise<TargetResetOutcome> {
  if (reset.kind === "none") {
    return {
      kind: "none",
      applied: false,
      ok: true,
      detail: `${config.target.name} keeps its data between executions — these people will find whatever the last lot left behind`,
    };
  }
  if (reset.kind === "http") {
    try {
      const response = await fetch(reset.url, { method: reset.method, headers: reset.headers });
      return { kind: "http", applied: true, ok: response.ok, detail: `${reset.method} ${reset.url} → ${response.status}` };
    } catch (err) {
      return { kind: "http", applied: true, ok: false, detail: `${reset.method} ${reset.url} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const endpoint = config.target.mcp.find((e) => e.name === reset.endpoint) ?? config.target.mcp[0];
  if (!endpoint) return { kind: "tool", applied: false, ok: false, detail: `no MCP endpoint called ${reset.endpoint}` };
  const session = new McpSession(endpoint, undefined);
  try {
    await session.connect();
    const args: JsonObject = reset.arguments;
    const outcome = await session.call(reset.tool, args);
    return { kind: "tool", applied: true, ok: !outcome.result.isError, detail: `${reset.tool} → ${outcome.result.text.slice(0, 200)}` };
  } catch (err) {
    return { kind: "tool", applied: true, ok: false, detail: `${reset.tool} failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    await session.close();
  }
}
