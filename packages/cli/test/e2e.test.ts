import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
const dbg = (m: string) => appendFileSync(process.env.E2E_LOG ?? "/dev/null", `${Date.now() % 100000} ${m}\n`);
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { LocalDaemon } from "@populace/runner";
import { ScriptedProvider, byWake, call, field, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configTemplate, currentRunId, loadConfig, storePath } from "../src/index.js";

let target: RunningMockTarget;
let dir: string;
beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
  dir = mkdtempSync(join(tmpdir(), "populace-e2e-"));
  const yaml = configTemplate(target.url)
    .replace("cadence: { every: 2m, jitter: 30s }", "cadence: { every: 300ms, jitter: 0s }")
    .replace("visitsPerPerson: 4", "visitsPerPerson: 3")
    .replace("tick: 5s", "tick: 100ms")
    .replace("judge: model", "judge: heuristic");
  // The patches above are string replacements against the template, so a template edit turns them
  // into silent no-ops and this test HANGS on a two-minute cadence rather than failing. Assert
  // that each one landed, so a template change is a red test instead of a wedged one.
  for (const patched of ["every: 300ms", "visitsPerPerson: 3", "tick: 100ms", "judge: heuristic"]) expect(yaml).toContain(patched);
  writeFileSync(join(dir, "populace.yaml"), yaml);
});
afterAll(async () => {
  await target.close();
});

const cli = resolve(import.meta.dirname, "../dist/cli.js");
const execFileAsync = promisify(execFile);
/** Runs the built CLI as a subprocess. Must stay async: the mock target is served by this test process. */
async function populace(...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("node", [cli, ...args], { cwd: dir, encoding: "utf8", timeout: 30_000, env: { ...process.env, NODE_OPTIONS: "--no-warnings" } });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`populace ${args.join(" ")} failed: ${e.message}\nstdout:\n${e.stdout ?? ""}\nstderr:\n${e.stderr ?? ""}`);
  }
}

const signUp = (ctx: ScriptContext) => {
  const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
  if (!s) throw new Error("no signup suggestion");
  return { calls: [call("sign_up", { email: s[1]!, displayName: s[2]!, password: s[3]! })] };
};
const ref = (ctx: ScriptContext, name: string, includes = ""): string => ctx.allResults.find((r) => r.name === name && r.text.includes(includes))?.ref ?? "";

/** Every persona: sign up on wake 1, remember it; later wakes act on memory and file one finding each. */
const policy: ScriptPolicy = byWake(
  {
    1: sequence([
      signUp,
      () => ({ calls: [call("create_project", { name: "Main" })] }),
      (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "First Thing", dueDate: "2026-10-01" }), call("remember", { kind: "done", text: "Signed up and created project Main." })] }),
    ]),
    2: sequence([
      (ctx) => {
        expect(ctx.wakeContext).toContain("Signed up and created project Main.");
        return { calls: [call("search_tasks", { query: "first" })] };
      },
      (ctx) => ({
        calls: [
          call("file_finding", { kind: "bug", title: "search_tasks is case-sensitive", description: "d", expected: "'first' finds 'First Thing'", observed: "0 results", severity: "medium", confidence: 0.9, tool: "search_tasks", evidence_calls: [ref(ctx, "search_tasks")] }),
          call("remember", { kind: "annoyance", text: "Search is case-sensitive." }),
        ],
      }),
    ]),
    3: sequence([
      (ctx) => {
        expect(ctx.wakeContext).toContain("Search is case-sensitive.");
        return { calls: [call("list_tasks", {})] };
      },
      (ctx) => ({
        calls: [
          call("file_finding", { kind: "coverage-gap", title: "No way to delete a task", description: "d", expected: "A delete_task tool exists.", observed: "No such tool and no workaround.", severity: "medium", confidence: 0.8, tool: "delete_task", evidence_calls: [ref(ctx, "list_tasks")] }),
        ],
      }),
    ]),
  },
  sequence([]),
);

describe("local daemon + CLI end to end", () => {
  it("runs a three-persona population for several wakes each with memory carrying across, then digests and sweeps through the CLI", async () => {
    const loaded = loadConfig(join(dir, "populace.yaml"));
    const runId = currentRunId(loaded, { newRun: true });
    const store = new SqliteStore(storePath(loaded));
    const daemon = new LocalDaemon({ config: loaded.config, runId }, { store, provider: new ScriptedProvider(policy), identityProvider: new SelfSignupProvider(loaded.config.identity as never) });
    dbg("daemon start");
    await daemon.run(); // ends when every agent has reached maxWakes
    dbg(`daemon done ${daemon.wakesRun}`);
    expect(daemon.wakesRun).toBe(9);

    const agents = await store.listAgents({ runId });
    expect(agents.map((a) => a.status)).toEqual(["retired", "retired", "retired"]);
    expect(agents.map((a) => a.wakeCount)).toEqual([3, 3, 3]);
    for (const agent of agents) {
      const wakes = await store.listWakes({ agentId: agent.id });
      expect(wakes.map((w) => w.wakeNumber)).toEqual([1, 2, 3]);
      expect(wakes.every((w) => w.status === "done")).toBe(true);
      expect((await store.getMemory(agent.runId, agent.id))?.annoyances).toHaveLength(1);
      expect(agent.identityId).not.toBeNull();
    }
    expect(await store.listIdentitiesByTag(`populace:${runId}`)).toHaveLength(3);
    await store.close();
    dbg("store closed");

    // status and digest through the real CLI against the same store
    const status = await populace("status");
    expect(status).toContain(runId);
    expect(status).toContain("3 agent(s), 9 wake(s), 6 finding(s)");

    const out = await populace("digest", "--since", "1h");
    expect(out).toContain("verified 6 finding(s) with the heuristic judge");
    expect(out).toContain("2 cluster(s)");
    const file = /written to (.+\.md)/.exec(out)?.[1];
    expect(file).toBeDefined();
    const markdown = readFileSync(file!, "utf8");
    expect(markdown).toContain("search_tasks is case-sensitive");
    expect(markdown).toContain("`delete_task`");
    expect(markdown).toContain("3 personas");
    expect(markdown).toMatch(/3 confirmed/);

    // A bare sweep tears down the three accounts on the target and KEEPS the evidence: the digest
    // above is the reason the run happened, and losing it is asked for by name.
    //
    // Asked by RUN ID, because that is what the addresses carry. A tag is `populace:run_…` and a
    // colon is not legal in an email local part, so a person's address embeds the run id alone
    // (ADR-0037) — and this route finds users by an email substring, as a real admin API would.
    const before = (await (await fetch(`${target.url}/admin/users?tag=${runId}`, { headers: { "x-admin-token": target.adminToken } })).json()) as { users: object[] };
    expect(before.users).toHaveLength(3);
    const swept = await populace("sweep");
    expect(swept).toContain("3 identities tagged");
    expect(swept).toContain("tore down");
    expect(swept).not.toContain("removed 3 agent(s)");
    const after = (await (await fetch(`${target.url}/admin/users?tag=${runId}`, { headers: { "x-admin-token": target.adminToken } })).json()) as { users: object[] };
    expect(after.users).toHaveLength(0);
    expect(await populace("status")).toContain("3 agent(s), 9 wake(s), 6 finding(s)");

    // --delete-data is the one that throws the run's rows away.
    const deleted = await populace("sweep", "--delete-data");
    expect(deleted).toContain("removed 3 agent(s), 9 wake(s), 6 finding(s)");
    expect(await populace("status")).toContain("0 agent(s), 0 wake(s), 0 finding(s)");
  });

  it("kill switch toggles through the CLI", async () => {
    expect(await populace("kill", "--reason", "test")).toContain("ENGAGED");
    expect(await populace("kill", "--status")).toContain("ENGAGED");
    expect(await populace("kill", "--release")).toContain("released");
  });
});
