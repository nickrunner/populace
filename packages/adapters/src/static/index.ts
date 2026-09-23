import { readFileSync } from "node:fs";
import { CredentialSchema, REDEEM_SKEW_MS, type Agent, type Identity, type IdentityProvider, type ProvisionContext, type ProvisionResult, type StaticIdentityConfig, type TeardownDeps } from "@populace/core";
import { z } from "zod";

/**
 * A pool entry must carry its own bearer. `CredentialSchema` makes `bearerToken` optional because a
 * Firebase bearer is derived from a redeemable, but a static pool has nothing to derive one from: a
 * typo'd key or a blanked-out rotated entry would parse, and the wake would then connect with the
 * endpoint's own gateway token — every agent authenticating as the SAME shared account, which is a
 * wrong-data run rather than a failed one. Required here, so the file fails loudly at construction.
 */
const EntrySchema = CredentialSchema.extend({ bearerToken: z.string().min(1), personaId: z.string().optional(), tags: z.array(z.string()).default([]) });
type Entry = z.infer<typeof EntrySchema>;
const EntriesSchema = z.array(EntrySchema);

/**
 * The preferred shape: one list per COHORT.
 *
 * An account is handed to a person by their ordinal within their cohort, which is the only index
 * that is stable across processes — and an ordinal is only unambiguous when the list it indexes
 * belongs to one cohort. Two cohorts sharing a persona both have a person 1, so a persona-keyed
 * list would hand both of them entry 1.
 */
const CohortKeyedSchema = z.object({ byCohort: z.record(z.string(), EntriesSchema) });
/** The shipped shapes, kept working: a record keyed by persona id, or a flat array (entries may name their persona). */
const LegacyFileSchema = z.union([EntriesSchema, z.record(z.string(), EntriesSchema)]);

/** Which entry an agent draws, derived from the agent alone. */
interface Assignment {
  /** The key in the pool file this agent draws from. */
  key: string;
  /** Position within that key's list. */
  index: number;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Every field that names the ACCOUNT behind an entry, not just the bearer that reaches it.
 *
 * Two entries can be two spellings of one login — a second API key for the same user, a rotated
 * token pasted in beside the one it replaced — and matching on the bearer alone waves those
 * through. The two people holding them are then the same account on the target, seeing each
 * other's data and filing "independent" reports that are nothing of the kind: exactly the failure
 * the distinctness check exists to refuse. The label is what the user is shown; the key is what is
 * compared, and a bearer token never appears in a message.
 */
function identifiers(entry: Entry): { key: string; label: string }[] {
  const ids = [{ key: `bearer:${entry.bearerToken}`, label: "the same bearer token" }];
  if (entry.userId !== undefined && entry.userId !== "") ids.push({ key: `user:${entry.userId}`, label: `both entries name userId ${entry.userId}` });
  if (entry.email !== undefined && entry.email !== "") ids.push({ key: `email:${entry.email.toLowerCase()}`, label: `both entries name ${entry.email}` });
  return ids;
}

/**
 * Credentials from a file, one account per person (ADR-0012).
 *
 * The file is one of:
 *
 * ```json
 * { "byCohort": { "weekend-planners": [ { "bearerToken": "..." } ], "sceptics": [ ... ] } }
 * { "casual-lister": [ { "bearerToken": "..." } ] }          // legacy: keyed by persona id
 * [ { "bearerToken": "...", "personaId": "casual-lister" } ] // legacy: flat
 * ```
 *
 * Assignment is DETERMINISTIC: person n of a cohort always gets entry n of their pool, in every
 * process and after every restart. It used to be a per-instance hand-out counter modulo the pool
 * size, which meant a pool smaller than the population silently wrapped — several simulated people
 * were then literally the same account on the target, seeing each other's data and filing
 * "independent" reports that were nothing of the kind — and a restart mid-run (pause/resume makes
 * those routine) re-handed entry 1 to whoever provisioned next. Exhaustion is now an error, and
 * the population-wide property is checked by `checkPopulation` before a run starts.
 */
export class StaticIdentityProvider implements IdentityProvider {
  readonly strategy = "static" as const;
  /** These logins existed before populace and belong to whoever pasted them in. Sweep must not claim it removed them. */
  readonly ownsAccounts = false;
  private readonly pool = new Map<string, Entry[]>();
  private readonly keyedBy: "cohort" | "persona";

  constructor(private readonly config: StaticIdentityConfig) {
    // eslint-disable-next-line no-restricted-syntax -- credentials file boundary, parsed with zod immediately.
    const raw = JSON.parse(readFileSync(config.file, "utf8")) as unknown;
    // Shape first, then parse, so a cohort-keyed file with a bad entry fails as a bad ENTRY rather
    // than falling through to the legacy schema and complaining that it is not a persona map.
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "byCohort" in raw) {
      this.keyedBy = "cohort";
      for (const [cohort, entries] of Object.entries(CohortKeyedSchema.parse(raw).byCohort)) this.ensure(cohort).push(...entries);
    } else {
      this.keyedBy = "persona";
      const parsed = LegacyFileSchema.parse(raw);
      if (Array.isArray(parsed)) for (const entry of parsed) this.ensure(entry.personaId ?? "*").push(entry);
      else for (const [personaId, entries] of Object.entries(parsed)) this.ensure(personaId).push(...entries);
    }
  }

  /**
   * A key EXISTS from the moment the file names it, whether or not it holds anything. A list that
   * has been emptied out — a rotated-away persona, a key left as `[]` — is a key the user wrote,
   * and resolving it to the `"*"` fallback instead pointed the error at a key their file does not
   * contain, which is the opposite of telling them what to add.
   */
  private ensure(key: string): Entry[] {
    const list = this.pool.get(key) ?? [];
    this.pool.set(key, list);
    return list;
  }

  /**
   * The entry this agent gets: derived from the agent's cohort and ordinal, never from how many
   * accounts this process has handed out already. A provider built fresh after a restart gives
   * every person the account they had before, which is also what a longitudinal simulation wants —
   * the same person comes back to the same account next week.
   */
  private assign(agent: Agent): Assignment {
    if (this.keyedBy === "cohort") return { key: agent.cohortSlug, index: agent.ordinal };
    const personaId = agent.persona.id;
    return { key: this.pool.has(personaId) ? personaId : "*", index: agent.ordinal };
  }

  private missing(key: string, needed: number): string {
    const known = [...this.pool.keys()].sort();
    const held = known.length === 0 ? "nothing" : known.map((k) => `"${k}" (${(this.pool.get(k) ?? []).length})`).join(", ");
    const shape = `${this.keyedBy === "cohort" ? '"byCohort" holds' : "the file holds"} ${held}`;
    const head = this.pool.has(key) ? `the static pool "${key}" in ${this.config.file} is empty` : `no static credentials under "${key}" in ${this.config.file}`;
    return `${head}: ${needed} ${plural(needed, "person needs", "people need")} an account and ${shape}`;
  }

  private shortfall(key: string, held: number, needed: number, who: string): string {
    return (
      `the static pool "${key}" in ${this.config.file} holds ${held} ${plural(held, "entry", "entries")}, ` +
      `but ${needed} ${plural(needed, "person needs", "people need")} an account (${who}): ` +
      `add ${needed - held} more ${plural(needed - held, "entry", "entries")} under "${key}"`
    );
  }

  provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    const { key, index } = this.assign(ctx.agent);
    const list = this.pool.get(key);
    if (!list || list.length === 0) return Promise.reject(new Error(this.missing(key, index + 1)));
    const entry = list[index];
    // No modulo. Wrapping would hand this person somebody else's account rather than fail.
    if (!entry) return Promise.reject(new Error(this.shortfall(key, list.length, index + 1, `${ctx.agent.id} is person ${index + 1} of "${key}"`)));
    const { personaId: _p, tags: _t, ...credential } = entry;
    return Promise.resolve({ kind: "credential", credential });
  }

  /**
   * Every person must map to a DISTINCT entry. Three things break that, and none of them is
   * visible from one agent: too few entries, one legacy pool serving more than one cohort (both
   * number their people from 1, so both would take the same entries), and the same bearer pasted
   * into the file twice.
   *
   * And a fourth thing, which is not about distinctness at all: **a dead token**. This provider
   * implements no `refresh` and there is nothing for it to redeem — a human pasted these in — so
   * `wake.ts` skips redemption entirely, the visit connects with an expired bearer and ends
   * `auth-failed`. Every `expiresAt` in the file is in hand right here, at the one moment before
   * any money is spent, and saying nothing about it is the one limitation of this way in that is
   * otherwise invisible until every person has failed.
   */
  checkPopulation(agents: readonly Agent[]): string[] {
    const problems: string[] = [];
    const dead = this.expired(new Date());
    if (dead.length > 0) {
      problems.push(
        `${dead.length} ${plural(dead.length, "entry in", "entries in")} ${this.config.file} ${plural(dead.length, "has", "have")} already expired or will within the ${Math.round(REDEEM_SKEW_MS / 60_000)} minutes a visit is given (${dead.join(", ")}): ` +
          `populace cannot renew a pasted-in login, so those people would connect with a dead token and every visit would end at the front door. ` +
          `Replace them, or drop \`expiresAt\` if the token in fact does not expire`,
      );
    }
    const byKey = new Map<string, Agent[]>();
    for (const agent of agents) {
      const { key } = this.assign(agent);
      const group = byKey.get(key) ?? [];
      group.push(agent);
      byKey.set(key, group);
    }
    /** identifier -> the agent already holding it, so a duplicated entry is caught too. */
    const takenBy = new Map<string, string>();
    for (const key of [...byKey.keys()].sort()) {
      const group = byKey.get(key) ?? [];
      const list = this.pool.get(key) ?? [];
      const cohorts = [...new Set(group.map((a) => a.cohortSlug))].sort();
      if (list.length === 0) {
        problems.push(this.missing(key, group.length));
        continue;
      }
      if (this.keyedBy !== "cohort" && cohorts.length > 1) {
        const suggestion = cohorts.map((c) => `"${c}": [...]`).join(", ");
        problems.push(
          `the static pool "${key}" in ${this.config.file} serves ${cohorts.length} cohorts (${cohorts.join(", ")}), ` +
            `and every cohort numbers its people from 1, so they would be handed the same accounts: ` +
            `key the file by cohort instead — { "byCohort": { ${suggestion} } }`,
        );
        continue;
      }
      const needed = group.reduce((highest, agent) => Math.max(highest, agent.ordinal + 1), 0);
      if (needed > list.length) {
        problems.push(this.shortfall(key, list.length, Math.max(needed, group.length), `cohort${cohorts.length === 1 ? "" : "s"} ${cohorts.join(", ")}`));
        continue;
      }
      for (const agent of group) {
        const entry = list[agent.ordinal];
        if (!entry) continue;
        const ids = identifiers(entry);
        const clash = ids.find((id) => takenBy.has(id.key));
        if (clash) problems.push(`${agent.id} and ${takenBy.get(clash.key) ?? "?"} would use the same static credential in ${this.config.file} (${clash.label}); every person needs their own account`);
        else for (const id of ids) takenBy.set(id.key, agent.id);
      }
    }
    return problems;
  }

  /**
   * The entries whose token is dead, or dead before a visit could finish with it, named the way a
   * reader could find them in their own file: the pool key and the position in it, never a bearer.
   *
   * `credentialNeedsRedeem` is deliberately not reused. It answers "should this be renewed", and
   * the whole point here is that nothing will be — an entry with no `expiresAt` is taken at its
   * word exactly as a wake takes it, and only a stated expiry can be a problem.
   */
  private expired(now: Date): string[] {
    const named: string[] = [];
    for (const key of [...this.pool.keys()].sort()) {
      (this.pool.get(key) ?? []).forEach((entry, index) => {
        if (entry.expiresAt === null) return;
        if (Date.parse(entry.expiresAt) - REDEEM_SKEW_MS > now.getTime()) return;
        named.push(`"${key}" entry ${index + 1}, which expires ${entry.expiresAt}`);
      });
    }
    return named;
  }

  /**
   * Deliberately nothing. These accounts existed before the run and deleting them would be
   * destroying somebody else's data; `ownsAccounts` is what stops a sweep reporting this as a
   * removal.
   */
  teardown(): Promise<void> {
    return Promise.resolve();
  }

  listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    return deps.listStoredIdentities(tag);
  }
}
