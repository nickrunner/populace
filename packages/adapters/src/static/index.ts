import { readFileSync } from "node:fs";
import { CredentialSchema, type Identity, type IdentityProvider, type ProvisionContext, type ProvisionResult, type StaticIdentityConfig, type TeardownDeps } from "@populace/core";
import { z } from "zod";

const EntrySchema = CredentialSchema.extend({ personaId: z.string().optional(), tags: z.array(z.string()).default([]) });
const FileSchema = z.union([z.array(EntrySchema), z.record(z.string(), z.array(EntrySchema))]);

/** Credentials from a file. Entries are handed out per persona in order; teardown is a no-op. */
export class StaticIdentityProvider implements IdentityProvider {
  readonly strategy = "static" as const;
  private readonly pool = new Map<string, z.infer<typeof EntrySchema>[]>();
  private readonly handedOut = new Map<string, number>();

  constructor(private readonly config: StaticIdentityConfig) {
    // eslint-disable-next-line no-restricted-syntax -- credentials file boundary, parsed with zod immediately.
    const parsed = FileSchema.parse(JSON.parse(readFileSync(config.file, "utf8")) as unknown);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) this.add(entry.personaId ?? "*", entry);
    } else {
      for (const [personaId, entries] of Object.entries(parsed)) for (const entry of entries) this.add(personaId, entry);
    }
  }

  private add(personaId: string, entry: z.infer<typeof EntrySchema>): void {
    const list = this.pool.get(personaId) ?? [];
    list.push(entry);
    this.pool.set(personaId, list);
  }

  provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    const personaId = ctx.agent.persona.id;
    const list = this.pool.get(personaId) ?? this.pool.get("*") ?? [];
    const key = this.pool.has(personaId) ? personaId : "*";
    const index = this.handedOut.get(key) ?? 0;
    const entry = list[index % Math.max(1, list.length)];
    if (!entry) return Promise.reject(new Error(`no static credentials for persona ${personaId} in ${this.config.file}`));
    this.handedOut.set(key, index + 1);
    const { personaId: _p, tags: _t, ...credential } = entry;
    return Promise.resolve({ kind: "credential", credential });
  }

  teardown(): Promise<void> {
    return Promise.resolve();
  }

  listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    return deps.listStoredIdentities(tag);
  }
}
