import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRunId, tagForRun, type Finding, type Identity } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweep } from "./commands.js";

/** A checkout with a static pool of two accounts and a store, ready for a sweep. */
function checkout(): { configPath: string; storeFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "populace-sweep-"));
  const credsFile = join(dir, "creds.json");
  const storeFile = join(dir, "populace.sqlite");
  writeFileSync(credsFile, JSON.stringify({ byCohort: { casual: [{ bearerToken: "pool-1" }, { bearerToken: "pool-2" }] } }));
  const configPath = join(dir, "populace.yaml");
  writeFileSync(
    configPath,
    `version: 2
target:
  name: Tasklet
  mcp:
    - name: default
      url: http://127.0.0.1:4999/mcp
identity:
  strategy: static
  file: ${credsFile}
store:
  kind: sqlite
  path: ${storeFile}
population:
  id: pop
  name: Everyone
cohorts:
  - slug: casual
    size: 2
    persona:
      id: casual
      name: Casual
      role: a hobbyist with lists
      backstory: They keep grocery lists.
      goals: [keep a list]
`,
  );
  return { configPath, storeFile };
}

function identity(runId: string, n: number): Identity {
  return {
    id: `idn_${n}`,
    runId,
    tag: tagForRun(runId),
    agentId: `pop/casual#${n}`,
    personaId: "casual",
    strategy: "static",
    credential: { bearerToken: `pool-${n}`, expiresAt: null, redeemable: null, email: `pool-${n}@example.test`, extra: {} },
    createdAt: new Date().toISOString(),
    tornDownAt: null,
  };
}

function finding(runId: string): Finding {
  return {
    id: "fnd_1",
    runId,
    tag: tagForRun(runId),
    wakeId: "wk_1",
    agentId: "pop/casual#1",
    personaId: "casual",
    kind: "bug",
    signature: "sig1:aaaaaaaaaaaa",
    title: "search is case sensitive",
    description: "d",
    expected: "e",
    observed: "o",
    severity: "high",
    confidence: 0.8,
    reproduction: [],
    endpoint: "default",
    identityId: "idn_1",
    verification: null,
    createdAt: new Date().toISOString(),
  };
}

async function seed(storeFile: string, runId: string): Promise<void> {
  const store = new SqliteStore(storeFile);
  await store.saveIdentity(identity(runId, 1));
  await store.saveIdentity(identity(runId, 2));
  await store.saveFinding(finding(runId));
  await store.close();
}

describe("populace sweep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Static accounts are PRE-EXISTING: populace did not create them, so deleting them would be
   * destroying somebody else's data and the no-op teardown is right. What was wrong was the
   * reporting — a non-throwing teardown counted as `removed++` and logged "tore down", so the user
   * was told their accounts were gone while they sat there, and `failures === 0` was a guard that
   * could not fail.
   */
  it("reports static identities as pre-existing and removes nothing", async () => {
    const { configPath, storeFile } = checkout();
    const runId = newRunId();
    await seed(storeFile, runId);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));

    const result = await sweep({ config: configPath, run: runId });

    expect(result.identities).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.preExisting).toBe(2);
    expect(result.failures).toBe(0);
    expect(lines.join("\n")).toContain("2 identities used pre-existing accounts; populace did not create them and has not removed them.");
    expect(lines.join("\n")).not.toContain("tore down");
  });

  /**
   * `--keep-data` used to be the flag, so a bare `populace sweep` deleted the wakes, traces and
   * findings the run had paid a model to produce — while the dashboard, calling the same function,
   * kept them. Losing the evidence is now something the user asks for by name.
   */
  it("keeps the run's findings when no flags are given, and deletes them only for --delete-data", async () => {
    const { configPath, storeFile } = checkout();
    const runId = newRunId();
    await seed(storeFile, runId);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sweep({ config: configPath, run: runId });
    const afterBare = new SqliteStore(storeFile);
    expect(await afterBare.listFindings({ runIds: [runId] })).toHaveLength(1);
    await afterBare.close();

    // The old flag still parses and still means what it says, so scripts carrying it keep working.
    await sweep({ config: configPath, run: runId, keepData: true });
    const afterKeep = new SqliteStore(storeFile);
    expect(await afterKeep.listFindings({ runIds: [runId] })).toHaveLength(1);
    await afterKeep.close();

    await sweep({ config: configPath, run: runId, deleteData: true });
    const afterDelete = new SqliteStore(storeFile);
    expect(await afterDelete.listFindings({ runIds: [runId] })).toHaveLength(0);
    await afterDelete.close();
  });

  /**
   * Asked for both, the SAFE one wins. `--keep-data` reads as a guarantee, and a wrapper that
   * appends it defensively to a user-supplied argument list is worth nothing if the destructive
   * flag quietly outranks it — the point of the change is that losing the evidence has to be
   * asked for unambiguously, and "both" is not unambiguous.
   */
  it("keeps the findings when --keep-data and --delete-data are both given, and says so", async () => {
    const { configPath, storeFile } = checkout();
    const runId = newRunId();
    await seed(storeFile, runId);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));

    await sweep({ config: configPath, run: runId, keepData: true, deleteData: true });

    const after = new SqliteStore(storeFile);
    expect(await after.listFindings({ runIds: [runId] })).toHaveLength(1);
    await after.close();
    expect(lines.join("\n")).toContain("--keep-data and --delete-data ask for opposite things");
  });
});
