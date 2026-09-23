import { identityProviderFor } from "@populace/adapters";
import { tagForRun, type Identity, type JsonValue, type PopulaceConfig, type Store, type TeardownDeps } from "@populace/core";
import { McpSession } from "@populace/runner";

export interface SweepOptions {
  dryRun: boolean;
  /**
   * Keep the run's evidence and only remove the accounts. TRUE is the default everywhere — the
   * dashboard, the auto-sweep at the end of an ephemeral run, and `populace sweep`. Deleting the
   * wakes, traces and findings a run paid for is something the user asks for by name
   * (`populace sweep --delete-data`), not what happens when they forget a flag.
   */
  keepData: boolean;
}

export interface SweepResult {
  identities: number;
  /** Accounts actually deleted from the target. Never counts a teardown that did not happen. */
  removed: number;
  /** Identities on accounts populace never created (a static pool), so there was nothing to remove. */
  preExisting: number;
  /** Accounts populace DID create and cannot delete — a self-signup target with no teardown tool. Still on the product. */
  stranded: number;
  failures: number;
  lines: string[];
}

/**
 * Removes the accounts a run created on the target, and optionally the run's own rows.
 *
 * Shared by `populace sweep` and the dashboard's sweep job so there is one behaviour: an identity
 * this run tagged is torn down through the same provider that created it, and evidence is only
 * deleted when every account is accounted for — a half-swept run whose findings were dropped
 * leaves accounts on someone's product with nothing left to say which they were.
 *
 * "Accounted for" is three outcomes, and only one of them is a removal. A provider that declares
 * `ownsAccounts: false` created none of them (a static pool), so nothing is torn down and nothing
 * needed to be. A provider that declares `cannotRemove` created them and has no way to delete them
 * (self-signup with no `teardownTool`), so they are STILL THERE: those are counted apart, said in
 * words, and they hold back both the `sweptAt` stamp and `--delete-data`, because the run's own
 * rows are the only remaining record of which accounts were left behind.
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

  // Asked BEFORE anything is torn down, because `cannotRemove` on a provider that learns its
  // answer from the target is `undefined` until it has asked — and `undefined` reads as "it can
  // remove them". Nothing outside the tests called this, so a sweep against an app that
  // soft-deletes attempted every teardown, got `unsupported` back from each one and reported N
  // FAILURES: the wrong word for N accounts left behind, and the opposite of what ADR-0037
  // promised in writing. A failure to ask is reported and then ignored — the endpoint being down
  // is the teardown loop's news to break, in its own words, one account at a time.
  if (identityProvider.describe) {
    try {
      await identityProvider.describe();
    } catch (err) {
      lines.push(`  could not ask the target what it can do: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const found: Identity[] = await identityProvider.listByTag(tag, deps);
  lines.push(`run ${runId}: ${found.length} identit${found.length === 1 ? "y" : "ies"} tagged ${tag}`);

  // Saying "tore down" for something that was never torn down is the lie this guards against, and
  // there are two ways to reach it. `static` teardown is correctly a no-op — those logins belong to
  // whoever pasted them into the pool file. Self-signup WITHOUT a `teardownTool` is also a no-op,
  // but those accounts are populace's own and are still sitting on the product. Both used to be
  // counted as removals, which told the user their accounts were gone and made `failures === 0` a
  // guard that could not fail.
  const ownsAccounts = identityProvider.ownsAccounts !== false;
  const cannotRemove = ownsAccounts ? identityProvider.cannotRemove : undefined;

  let removed = 0;
  let preExisting = 0;
  let stranded = 0;
  let failures = 0;
  for (const identity of found) {
    const handle = identity.credential.email ?? identity.credential.userId ?? "?";
    // Counted before the dry-run branch: a dry run that printed "would leave it alone" for every
    // identity and then returned zeroes was indistinguishable, to anything reading the numbers
    // rather than the prose, from having found nothing at all.
    if (!ownsAccounts) {
      preExisting++;
      lines.push(options.dryRun ? `  would leave ${identity.id} (${handle}) alone; populace did not create it` : `  left ${identity.id} (${handle}) alone; populace did not create it`);
      continue;
    }
    if (cannotRemove !== undefined) {
      stranded++;
      lines.push(`  CANNOT REMOVE ${identity.id} (${handle}); the account is still on the target`);
      continue;
    }
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

  if (preExisting > 0) {
    lines.push(`  ${preExisting} identit${preExisting === 1 ? "y" : "ies"} used pre-existing accounts; populace did not create them and has not removed them.`);
  }
  if (stranded > 0) {
    lines.push(`  ${stranded} identit${stranded === 1 ? "y" : "ies"} could not be removed: ${cannotRemove ?? ""}.`);
  }

  if (!options.dryRun && failures === 0 && stranded === 0) {
    // The accounts this run made are gone, so the row stops claiming they are still on the target.
    const run = await store.getRun(runId);
    if (run && run.sweptAt === null) await store.saveRun({ ...run, sweptAt: new Date().toISOString() });
  }

  if (!options.dryRun && !options.keepData && stranded > 0) {
    lines.push(`  keeping this run's wakes, traces and findings: they are the only record of which accounts are still on the target.`);
  }

  if (!options.dryRun && !options.keepData && failures === 0 && stranded === 0) {
    const f = await store.deleteFindingsByRun(runId);
    const w = await store.deleteWakesByRun(runId);
    const a = await store.deleteAgentsByRun(runId);
    const i = await store.deleteIdentitiesByRun(runId);
    await store.deleteRun(runId);
    lines.push(`  removed ${a} agent(s), ${w} wake(s), ${f} finding(s), ${i} identity record(s)`);
  }
  return { identities: found.length, removed, preExisting, stranded, failures, lines };
}
