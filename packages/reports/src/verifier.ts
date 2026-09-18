import type Anthropic from "@anthropic-ai/sdk";
import {
  JsonObjectSchema,
  costOf,
  priceFor,
  resolveModel,
  stableStringify,
  truncate,
  type Finding,
  type Identity,
  type JsonValue,
  type PopulaceConfig,
  type Store,
  type ToolCallRecord,
  type Verdict,
  type Verification,
} from "@populace/core";
import { McpSession, fetchPageText, toStrictInputSchema, type ModelProvider } from "@populace/runner";
import { z } from "zod";

export interface VerifierDeps {
  store: Store;
  config: PopulaceConfig;
  /** Required when the judge is `model`. */
  provider?: ModelProvider;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ReplayOutcome {
  steps: ToolCallRecord[];
  /** Tools the target currently exposes on the finding's endpoint. */
  toolNames: string[];
  identityUsed: Identity | null;
  error: string | null;
}

/**
 * Mechanical half of verification (ADR-0014): replay the reproduction steps
 * with the finding's identity and record what the target does now.
 */
export async function replayFinding(finding: Finding, deps: VerifierDeps): Promise<ReplayOutcome> {
  const now = deps.now ?? (() => new Date());
  const endpoint = deps.config.target.mcp.find((e) => e.name === finding.endpoint) ?? deps.config.target.mcp[0];
  if (!endpoint) return { steps: [], toolNames: [], identityUsed: null, error: "target has no MCP endpoint" };
  const identity = finding.identityId ? ((await deps.store.getIdentity(finding.identityId)) ?? null) : null;
  const usable = identity && identity.tornDownAt === null ? identity : null;
  const session = new McpSession(endpoint, usable?.credential.bearerToken);
  try {
    await session.connect();
  } catch (err) {
    return { steps: [], toolNames: [], identityUsed: usable, error: `could not connect: ${err instanceof Error ? err.message : String(err)}` };
  }
  const steps: ToolCallRecord[] = [];
  try {
    for (const [index, step] of finding.reproduction.entries()) {
      const at = now().toISOString();
      if (step.endpoint === "web") {
        const args = JsonObjectSchema.safeParse(step.arguments);
        const path = args.success && typeof args.data.path === "string" ? args.data.path : "/";
        const base = deps.config.target.webBaseUrl;
        const page = base ? await fetchPageText(base, path, deps.config.guardrails.maxToolResultChars) : { ok: false as const, error: "no web base url" };
        steps.push({ ref: `v${index + 1}`, endpoint: "web", tool: "fetch_page", arguments: { path }, result: { text: page.ok ? page.text : page.error, isError: !page.ok }, latencyMs: 0, traceSeq: index, at });
        continue;
      }
      const args = JsonObjectSchema.safeParse(step.arguments);
      const started = Date.now();
      if (!session.hasTool(step.tool)) {
        steps.push({ ref: `v${index + 1}`, endpoint: endpoint.name, tool: step.tool, arguments: step.arguments, result: { text: `error: tool ${step.tool} no longer exists`, isError: true }, latencyMs: 0, traceSeq: index, at });
        continue;
      }
      const outcome = await session.call(step.tool, args.success ? args.data : {});
      steps.push({ ref: `v${index + 1}`, endpoint: endpoint.name, tool: step.tool, arguments: step.arguments, result: outcome.result, latencyMs: Date.now() - started, traceSeq: index, at });
    }
  } finally {
    await session.close();
  }
  return { steps, toolNames: session.listTools().map((t) => t.name), identityUsed: usable, error: null };
}

const VOLATILE_KEY = /(^id$|Id$|^token$|At$|^createdAt$|^updatedAt$|^password)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Strips ids, tokens and timestamps so two runs of the same call compare equal when the behaviour is the same. */
export function normalizeResult(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeResult);
  if (value !== null && typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key] as JsonValue;
      out[key] = VOLATILE_KEY.test(key) ? "<volatile>" : normalizeResult(v);
    }
    return out;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return "<timestamp>";
  return value;
}

function comparable(record: ToolCallRecord): string {
  if (record.result.structured !== undefined) return stableStringify(normalizeResult(record.result.structured));
  try {
    const parsed = JSON.parse(record.result.text) as JsonValue;
    return stableStringify(normalizeResult(parsed));
  } catch {
    return record.result.text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<timestamp>");
  }
}

/** Deterministic judge for CI and offline use (ADR-0014). */
export function heuristicJudge(finding: Finding, replay: ReplayOutcome): { verdict: Verdict; reason: string } {
  if (replay.error) return { verdict: "inconclusive", reason: replay.error };
  if (finding.kind === "coverage-gap") {
    const wanted = finding.tool;
    if (!wanted) return { verdict: "inconclusive", reason: "coverage gap names no tool" };
    return replay.toolNames.includes(wanted)
      ? { verdict: "not-reproduced", reason: `the target now exposes a tool named ${wanted}` }
      : { verdict: "confirmed", reason: `no tool named ${wanted} among ${replay.toolNames.length} tools on the target` };
  }
  if (finding.reproduction.length === 0) return { verdict: "inconclusive", reason: "finding carries no reproduction steps" };
  if (finding.kind === "praise" || finding.kind === "suggestion") return { verdict: "inconclusive", reason: `${finding.kind} findings are opinions; nothing to reproduce` };
  const mismatches: string[] = [];
  for (const [i, original] of finding.reproduction.entries()) {
    const replayed = replay.steps[i];
    if (!replayed) {
      mismatches.push(`step ${i + 1} (${original.tool}) was not replayed`);
      continue;
    }
    if (replayed.result.isError && !original.result.isError && /token|unauthori|not found|no longer exists/i.test(replayed.result.text)) {
      return { verdict: "inconclusive", reason: `step ${i + 1} (${original.tool}) failed on replay for an environmental reason: ${truncate(replayed.result.text, 160)}` };
    }
    if (replayed.result.isError !== original.result.isError) {
      mismatches.push(`step ${i + 1} (${original.tool}) ${replayed.result.isError ? "errored" : "succeeded"} on replay but ${original.result.isError ? "errored" : "succeeded"} originally`);
      continue;
    }
    if (comparable(original) !== comparable(replayed)) mismatches.push(`step ${i + 1} (${original.tool}) returned a different result`);
  }
  if (mismatches.length === 0) return { verdict: "confirmed", reason: `all ${finding.reproduction.length} reproduction steps behaved the same on replay` };
  // If the decisive last step matches, the behaviour the finding is about still holds even if setup steps drifted.
  const last = finding.reproduction.length - 1;
  const lastReplay = replay.steps[last];
  const lastOriginal = finding.reproduction[last];
  if (lastReplay && lastOriginal && lastReplay.result.isError === lastOriginal.result.isError && comparable(lastOriginal) === comparable(lastReplay)) {
    return { verdict: "confirmed", reason: `the final step (${lastOriginal.tool}) behaved the same on replay; earlier steps differed only in setup: ${mismatches.join("; ")}` };
  }
  return { verdict: "not-reproduced", reason: mismatches.join("; ") };
}

const VerdictInput = z.object({
  verdict: z.enum(["confirmed", "not-reproduced", "inconclusive"]),
  reason: z.string().min(1).describe("One or two sentences citing the specific replayed result that decided it."),
});

function describeSteps(steps: ToolCallRecord[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.arguments)})\n   -> ${s.result.isError ? "ERROR " : ""}${truncate(s.result.text, 1200)}`).join("\n");
}

/** Model judge: asks Claude to compare the original evidence with the replay. */
export async function modelJudge(finding: Finding, replay: ReplayOutcome, deps: VerifierDeps): Promise<{ verdict: Verdict; reason: string; costUsd: number }> {
  if (!deps.provider) throw new Error("model judge needs a model provider");
  if (replay.error) return { verdict: "inconclusive", reason: replay.error, costUsd: 0 };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: "text",
      text:
        "You verify bug reports filed by simulated users against a product's MCP tools. You are given the report, the exact tool calls the user made with their results, and a fresh replay of the same calls made just now. " +
        "Decide: confirmed (the replay shows the same wrong behaviour the report describes), not-reproduced (the replay shows the behaviour the report expected, or the problem is clearly the user's mistake), or inconclusive (the replay could not exercise the behaviour, e.g. auth or setup failures, or the report is an opinion). " +
        "Ignore differences in ids, tokens and timestamps. Answer only by calling the verdict tool.",
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools: Anthropic.Beta.BetaTool[] = [{ name: "verdict", description: "Record the verification verdict.", input_schema: toStrictInputSchema(VerdictInput), strict: true, cache_control: { type: "ephemeral" } }];
  const user =
    `Report (${finding.kind}, severity ${finding.severity}, persona ${finding.personaId}):\nTitle: ${finding.title}\nDescription: ${finding.description}\nExpected: ${finding.expected}\nObserved: ${finding.observed}\n\n` +
    `Original calls:\n${describeSteps(finding.reproduction)}\n\nReplay just now${replay.identityUsed ? " (same account)" : " (no account)"}:\n${describeSteps(replay.steps)}\n\n` +
    `Tools currently on the target: ${replay.toolNames.join(", ")}\n\nCall verdict.`;
  // The judge decides what reaches the digest, so it runs on its own model, independent of
  // whatever the agents were run with (`verifier.model`, defaulting to the strongest at high effort).
  const judge = resolveModel(deps.config.model, deps.config.verifier.model);
  const response = await deps.provider.complete({
    model: judge.model,
    effort: judge.effort,
    // A verdict is a couple of sentences; the cap stays low unless the config raises it,
    // because with thinking on, headroom here is spend.
    maxTokens: deps.config.verifier.model.maxTokens ?? 4000,
    system,
    tools,
    messages: [{ role: "user", content: user }],
    fallbacks: judge.fallbacks,
    metadata: { wakeId: `verify:${finding.id}`, wakeNumber: 0, agentId: "verifier", personaId: "verifier", runId: finding.runId },
  });
  const costUsd = costOf(response.usage, priceFor(judge.model, judge.prices));
  const call = response.message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "verdict");
  const parsed = call ? VerdictInput.safeParse(call.input) : undefined;
  if (!parsed?.success) return { verdict: "inconclusive", reason: "judge did not return a verdict", costUsd };
  return { ...parsed.data, costUsd };
}

/** Replays and judges one finding, persisting the verification. */
export async function verifyFinding(finding: Finding, deps: VerifierDeps): Promise<Verification> {
  const now = deps.now ?? (() => new Date());
  const replay = await replayFinding(finding, deps);
  const judge = deps.config.verifier.judge === "model" && deps.provider ? "model" : "heuristic";
  const decided = judge === "model" ? await modelJudge(finding, replay, deps) : { ...heuristicJudge(finding, replay), costUsd: 0 };
  const verification: Verification = { verdict: decided.verdict, reason: decided.reason, judge, replay: replay.steps, verifiedAt: now().toISOString(), costUsd: decided.costUsd };
  await deps.store.saveVerification(finding.id, verification);
  deps.log?.(`[verify] ${finding.id} ${finding.kind} "${truncate(finding.title, 60)}" -> ${verification.verdict} (${judge})`);
  return verification;
}

/** Verifies every unverified finding in the query, up to the configured maximum. Returns verified findings. */
export async function verifyPending(deps: VerifierDeps, query: { runIds?: string[]; since?: Date; until?: Date } = {}): Promise<Finding[]> {
  const pending = await deps.store.listFindings({ ...query, unverifiedOnly: true });
  const out: Finding[] = [];
  for (const finding of pending.slice(0, deps.config.verifier.maxFindings)) {
    const verification = await verifyFinding(finding, deps);
    out.push({ ...finding, verification });
  }
  return out;
}
