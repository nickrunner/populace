import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EffortSchema, expandPopulation, parseDuration, tagForRun, type Agent, type Identity, type JsonValue, type TeardownDeps } from "@populace/core";
import { LocalDaemon, McpSession, runWake, type WakeResult } from "@populace/runner";
import { buildDigest, exporterNamed, renderDigestMarkdown, verifyPending } from "@populace/reports";
import { parseDocument } from "yaml";
import { loadConfig } from "./config.js";
import { openContext, type CliContext } from "./context.js";
import { configTemplate } from "./template.js";

export interface GlobalOptions {
  config?: string;
  run?: string;
  quiet?: boolean;
}

function summarize(result: WakeResult): string {
  const w = result.wake;
  return `${w.agentId} wake #${w.wakeNumber}: ${w.status}; ${w.turns} turns, ${w.toolCalls} tool calls, ${w.findingCount} findings, $${w.costUsd.toFixed(4)}${w.summary ? `\n  ${w.summary}` : ""}`;
}

// ---- init ------------------------------------------------------------------

export function init(options: { dir?: string; target?: string; force?: boolean }): string {
  const dir = resolve(options.dir ?? ".");
  const file = resolve(dir, "populace.yaml");
  if (existsSync(file) && !options.force) throw new Error(`${file} already exists (use --force to overwrite)`);
  writeFileSync(file, configTemplate(options.target ?? "http://127.0.0.1:4310"));
  return file;
}

// ---- validate --------------------------------------------------------------

export async function validate(options: GlobalOptions & { connect?: boolean }): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const loaded = loadConfig(options.config ?? "populace.yaml");
  const { config } = loaded;
  lines.push(`config ${loaded.path}: valid`);
  lines.push(`target ${config.target.name}: ${config.target.mcp.length} MCP endpoint(s)${config.target.webBaseUrl ? `, web ${config.target.webBaseUrl}` : ""}`);
  lines.push(`identity: ${config.identity.strategy}`);
  lines.push(`model: ${config.model.model} effort=${config.model.effort} fallbacks=${config.model.fallbacks ? "on" : "off"}`);
  const agents = expandPopulation(config.population, "run_0_000000");
  lines.push(`population ${config.population.id}: ${config.population.members.length} persona(s) -> ${agents.length} agent(s) at scale ${config.population.scale}, cadence every ${config.population.cadence.every / 1000}s`);
  for (const { agent } of agents) lines.push(`  - ${agent.id} (${agent.persona.name}, patience ${agent.persona.patience}, budget $${agent.persona.budgetUsd})`);
  if (options.connect !== false) {
    for (const endpoint of config.target.mcp) {
      const session = new McpSession(endpoint, undefined);
      try {
        await session.connect();
        const tools = session.listTools();
        lines.push(`endpoint ${endpoint.name} (${endpoint.url}): ${tools.length} tools: ${tools.map((t) => t.name + (t.destructive ? "!" : "")).join(", ")}`);
        if (config.identity.strategy === "self-signup") {
          if (!session.hasTool(config.identity.signupTool)) {
            ok = false;
            lines.push(`  ERROR signup tool ${config.identity.signupTool} not found on ${endpoint.name}`);
          }
          if (config.identity.teardownTool && !session.hasTool(config.identity.teardownTool)) lines.push(`  WARNING teardown tool ${config.identity.teardownTool} not found; sweep will only forget identities`);
        }
        for (const { agent } of agents) {
          const denied = tools.filter((t) => !isAllowed(t.name, agent.persona.tools.allow, agent.persona.tools.deny)).map((t) => t.name);
          if (denied.length) lines.push(`  ${agent.id} cannot use: ${denied.join(", ")}`);
        }
      } catch (err) {
        ok = false;
        lines.push(`endpoint ${endpoint.name} (${endpoint.url}): ERROR ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await session.close();
      }
    }
  }
  if (!process.env.ANTHROPIC_API_KEY && !config.model.apiKey) lines.push("note: ANTHROPIC_API_KEY is not set; wake and run will fail until it is");
  return { ok, lines };
}

function isAllowed(name: string, allow: string[], deny: string[]): boolean {
  const glob = (p: string): RegExp => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  if (deny.some((p) => glob(p).test(name))) return false;
  return allow.length === 0 || allow.some((p) => glob(p).test(name));
}

// ---- wake ------------------------------------------------------------------

export async function wake(agentRef: string, options: GlobalOptions & { effort?: string; newRun?: boolean }): Promise<WakeResult> {
  const ctx = openContext(options);
  try {
    const daemon = new LocalDaemon({ config: ctx.loaded.config, runId: ctx.runId }, deps(ctx));
    const agents = await daemon.reconcile();
    const agent = agents.find((a) => a.id === agentRef) ?? agents.find((a) => a.persona.id === agentRef) ?? agents.find((a) => a.id.endsWith(`/${agentRef}`));
    if (!agent) throw new Error(`no agent matches ${agentRef}; known: ${agents.map((a) => a.id).join(", ")}`);
    const effort = options.effort ? EffortSchema.parse(options.effort) : undefined;
    const result = await runWake({ agent, config: ctx.loaded.config, ...(effort ? { effort } : {}) }, deps(ctx));
    ctx.log(summarize(result));
    for (const f of result.findings) ctx.log(`  finding ${f.id} [${f.kind}/${f.severity}] ${f.title}`);
    return result;
  } finally {
    await ctx.close();
  }
}

function deps(ctx: CliContext): Parameters<typeof runWake>[1] {
  return { store: ctx.store, provider: ctx.provider(), identityProvider: ctx.identityProvider, log: (line) => ctx.log(line) };
}

// ---- run -------------------------------------------------------------------

export async function run(options: GlobalOptions & { newRun?: boolean; maxWakes?: number; once?: boolean; continueFrom?: string }): Promise<{ runId: string; wakes: number }> {
  // A continuation is always a new run, so the before and after stay separately reportable.
  const ctx = openContext(options.continueFrom ? { ...options, newRun: true } : options);
  if (options.continueFrom === ctx.runId) throw new Error("--continue-from needs a previous run id, not the current one");
  try {
    const daemon = new LocalDaemon(
      {
        config: ctx.loaded.config,
        runId: ctx.runId,
        ...(options.maxWakes !== undefined ? { stopAfterTotalWakes: options.maxWakes } : {}),
        ...(options.continueFrom ? { continueFrom: options.continueFrom } : {}),
        onWake: (r) => ctx.log(summarize(r)),
      },
      deps(ctx),
    );
    const agents = await daemon.reconcile();
    if (options.continueFrom) {
      const returning = agents.filter((a) => a.continuedFrom !== null);
      ctx.log(`continuing ${options.continueFrom} as ${ctx.runId}: ${returning.length} agent(s) carried over (${returning.filter((a) => a.continuedFrom?.gaveUp).length} returning after giving up)`);
    }
    ctx.log(`run ${ctx.runId}: ${agents.length} agent(s), tick ${ctx.loaded.config.daemon.tick / 1000}s, concurrency ${ctx.loaded.config.daemon.concurrency}. Ctrl-C to stop; populace kill to stop all wakes.`);
    for (const a of agents) ctx.log(`  ${a.id} next wake ${a.nextWakeAt ?? "never"} (${a.wakeCount}${a.maxWakes ? `/${a.maxWakes}` : ""} wakes so far)`);
    if (options.once) {
      await daemon.tick();
    } else {
      const stop = (): void => {
        ctx.log("stopping after in-flight wakes finish");
        daemon.stop();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      await daemon.run();
    }
    ctx.log(`run ${ctx.runId}: ${daemon.wakesRun} wake(s) this session`);
    return { runId: ctx.runId, wakes: daemon.wakesRun };
  } finally {
    await ctx.close();
  }
}

// ---- scale -----------------------------------------------------------------

export async function scale(factor: string, options: GlobalOptions): Promise<Agent[]> {
  const value = Number(factor);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`scale factor must be a positive number, got ${factor}`);
  const loaded = loadConfig(options.config ?? "populace.yaml");
  const { readFileSync } = await import("node:fs");
  const doc = parseDocument(readFileSync(loaded.path, "utf8"));
  doc.setIn(["population", "scale"], value);
  writeFileSync(loaded.path, doc.toString());
  const ctx = openContext(options);
  try {
    const daemon = new LocalDaemon({ config: ctx.loaded.config, runId: ctx.runId }, deps(ctx));
    const agents = await daemon.reconcile();
    ctx.log(`population ${ctx.loaded.config.population.id} scale=${value}: ${agents.length} active agent(s) in run ${ctx.runId}`);
    return agents;
  } finally {
    await ctx.close();
  }
}

// ---- digest ----------------------------------------------------------------

export interface DigestOptions extends GlobalOptions {
  since?: string;
  until?: string;
  verify?: boolean;
  judge?: string;
  exporter?: string;
  out?: string;
  stdout?: boolean;
  allRuns?: boolean;
  includeNotReproduced?: boolean;
}

export async function digest(options: DigestOptions): Promise<{ markdown: string; location: string | null; clusters: number }> {
  const ctx = openContext(options);
  try {
    const config = ctx.loaded.config;
    if (options.judge) config.verifier.judge = options.judge === "model" ? "model" : "heuristic";
    const now = new Date();
    const since = new Date(now.getTime() - parseDuration(options.since ?? "24h"));
    const until = options.until ? new Date(now.getTime() - parseDuration(options.until)) : new Date(now.getTime() + 60_000);
    const runIds = options.allRuns ? undefined : [ctx.runId];
    if (options.verify !== false) {
      const verified = await verifyPending(
        { store: ctx.store, config, ...(config.verifier.judge === "model" ? { provider: ctx.provider() } : {}), log: (line) => ctx.log(line) },
        { ...(runIds ? { runIds } : {}), since, until },
      );
      ctx.log(`verified ${verified.length} finding(s) with the ${config.verifier.judge} judge`);
    }
    const built = await buildDigest({ store: ctx.store, config, since, until, ...(runIds ? { runIds } : {}), includeNotReproduced: options.includeNotReproduced ?? false });
    const markdown = renderDigestMarkdown(built);
    let location: string | null = null;
    if (options.stdout) console.log(markdown);
    else {
      const exporter = exporterNamed(options.exporter ?? "markdown-file");
      const result = await exporter.export(built, { outDir: resolve(ctx.loaded.dir, options.out ?? config.digestDir) });
      location = result.location;
      ctx.log(`digest: ${built.totals.findings} finding(s) in ${built.totals.clusters} cluster(s) from ${built.totals.wakes} wake(s), $${built.totals.costUsd.toFixed(2)}`);
      for (const [i, c] of built.clusters.entries()) ctx.log(`  ${i + 1}. [${c.kind}/${c.severity}] ${c.title} (${c.findings.length} report(s), ${c.confirmedCount} confirmed)`);
      ctx.log(`written to ${location}`);
    }
    return { markdown, location, clusters: built.clusters.length };
  } finally {
    await ctx.close();
  }
}

// ---- sweep -----------------------------------------------------------------

export async function sweep(options: GlobalOptions & { dryRun?: boolean; keepData?: boolean; allRuns?: boolean }): Promise<{ identities: number; failures: number }> {
  const ctx = openContext(options);
  try {
    const runIds = options.allRuns ? await ctx.store.listRunIds() : [ctx.runId];
    const endpoint = ctx.loaded.config.target.mcp[0];
    const teardownDeps: TeardownDeps = {
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
      listStoredIdentities: (tag: string) => ctx.store.listIdentitiesByTag(tag),
    };
    let identities = 0;
    let failures = 0;
    for (const runId of runIds) {
      const tag = tagForRun(runId);
      const found: Identity[] = await ctx.identityProvider.listByTag(tag, teardownDeps);
      ctx.log(`run ${runId}: ${found.length} identit${found.length === 1 ? "y" : "ies"} tagged ${tag}`);
      for (const identity of found) {
        identities++;
        if (options.dryRun) {
          ctx.log(`  would tear down ${identity.id} (${identity.credential.email ?? identity.credential.userId ?? "?"})`);
          continue;
        }
        try {
          await ctx.identityProvider.teardown(identity, teardownDeps);
          await ctx.store.markIdentityTornDown(identity.id, new Date());
          ctx.log(`  tore down ${identity.id} (${identity.credential.email ?? identity.credential.userId ?? "?"})`);
        } catch (err) {
          failures++;
          ctx.log(`  FAILED ${identity.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!options.dryRun && !options.keepData && failures === 0) {
        const f = await ctx.store.deleteFindingsByRun(runId);
        const w = await ctx.store.deleteWakesByRun(runId);
        const a = await ctx.store.deleteAgentsByRun(runId);
        const i = await ctx.store.deleteIdentitiesByRun(runId);
        ctx.log(`  removed ${a} agent(s), ${w} wake(s), ${f} finding(s), ${i} identity record(s)`);
      }
    }
    return { identities, failures };
  } finally {
    await ctx.close();
  }
}

// ---- kill ------------------------------------------------------------------

export async function kill(options: GlobalOptions & { release?: boolean; status?: boolean; reason?: string }): Promise<{ engaged: boolean }> {
  const ctx = openContext(options);
  try {
    if (!options.status) await ctx.store.setKillSwitch(!options.release, options.reason ?? (options.release ? "" : "populace kill"));
    const state = await ctx.store.getKillSwitch();
    ctx.log(state.engaged ? `kill switch ENGAGED${state.reason ? ` (${state.reason})` : ""} since ${state.at ?? "?"}: no wake will start or continue` : "kill switch released: wakes may run");
    return { engaged: state.engaged };
  } finally {
    await ctx.close();
  }
}

// ---- status ----------------------------------------------------------------

export async function status(options: GlobalOptions): Promise<string[]> {
  const ctx = openContext(options);
  try {
    const lines: string[] = [];
    const agents = await ctx.store.listAgents({ runId: ctx.runId });
    const wakes = await ctx.store.listWakes({ runIds: [ctx.runId] });
    const findings = await ctx.store.listFindings({ runIds: [ctx.runId] });
    const kill = await ctx.store.getKillSwitch();
    lines.push(`run ${ctx.runId} (${tagForRun(ctx.runId)})${kill.engaged ? "  KILL SWITCH ENGAGED" : ""}`);
    lines.push(`${agents.length} agent(s), ${wakes.length} wake(s), ${findings.length} finding(s), $${wakes.reduce((s, w) => s + w.costUsd, 0).toFixed(4)} spent`);
    for (const a of agents) {
      const own = wakes.filter((w) => w.agentId === a.id);
      const status = a.retiredReason ? `${a.status} (${a.retiredReason})` : a.status;
      lines.push(`  ${a.id}: ${status}, ${a.wakeCount} wake(s), ${findings.filter((f) => f.agentId === a.id).length} finding(s), identity ${a.identityId ?? "none"}, next ${a.nextWakeAt ?? "-"}${own.length ? `, last ${own[own.length - 1]?.status}` : ""}`);
    }
    for (const line of lines) ctx.log(line);
    return lines;
  } finally {
    await ctx.close();
  }
}
