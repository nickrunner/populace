import { identityProviderFor } from "@populace/adapters";
import { tagForRun, type Identity, type JsonValue, type PopulaceConfig, type Store, type TeardownDeps } from "@populace/core";
import { McpSession } from "@populace/runner";

export interface SweepOptions {
  dryRun: boolean;
  /** Keep the run's evidence and only remove the accounts. The dashboard's default. */
  keepData: boolean;
}

export interface SweepResult {
  identities: number;
  removed: number;
  failures: number;
  lines: string[];
}

/**
 * Removes the accounts a run created on the target, and optionally the run's own rows.
 *
 * Shared by `populace sweep` and the dashboard's sweep job so there is one behaviour: an identity
 * this run tagged is torn down through the same provider that created it, and evidence is only
 * deleted when every teardown succeeded — a half-swept run whose findings were dropped leaves
 * accounts on someone's product with nothing left to say which they were.
 */
export async function sweepRun(store: Store, config: PopulaceConfig, runId: string, options: SweepOptions): Promise<SweepResult> {
  const endpoint = config.target.mcp[0];
  const identityProvider = identityProviderFor(config.identity);
  const deps: TeardownDeps = {
    callTool: async (bearerToken: string | undefined, tool: string, args: JsonValue) => {
      if (!endpoint) return { isError: true, text: "no endpoint" };
      const session = new McpSession(endpoint, bearerToken);
      try {
        await session.connect();
        const outcome = await session.call(tool, typeof args === "object" && args !== null && !Array.isArray(args) ? args : {});
        return { isError: outcome.result.isError, text: outcome.result.text };
      } finally {
        await session.close();
      }
    },
    listStoredIdentities: (tag: string) => store.listIdentitiesByTag(tag),
  };

  const lines: string[] = [];
  const tag = tagForRun(runId);
  const found: Identity[] = await identityProvider.listByTag(tag, deps);
  lines.push(`run ${runId}: ${found.length} identit${found.length === 1 ? "y" : "ies"} tagged ${tag}`);

  let removed = 0;
  let failures = 0;
  for (const identity of found) {
    const handle = identity.credential.email ?? identity.credential.userId ?? "?";
    if (options.dryRun) {
      lines.push(`  would tear down ${identity.id} (${handle})`);
      continue;
    }
    try {
      await identityProvider.teardown(identity, deps);
      await store.markIdentityTornDown(identity.id, new Date());
      removed++;
      lines.push(`  tore down ${identity.id} (${handle})`);
    } catch (err) {
      failures++;
      lines.push(`  FAILED ${identity.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!options.dryRun && !options.keepData && failures === 0) {
    const f = await store.deleteFindingsByRun(runId);
    const w = await store.deleteWakesByRun(runId);
    const a = await store.deleteAgentsByRun(runId);
    const i = await store.deleteIdentitiesByRun(runId);
    await store.deleteRun(runId);
    lines.push(`  removed ${a} agent(s), ${w} wake(s), ${f} finding(s), ${i} identity record(s)`);
  }
  return { identities: found.length, removed, failures, lines };
}
