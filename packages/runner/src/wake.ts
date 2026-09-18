import type Anthropic from "@anthropic-ai/sdk";
import {
  JsonObjectSchema,
  JsonValueSchema,
  applyMemoryOperation,
  costOf,
  emptyMemory,
  isToolAllowed,
  newFindingId,
  newIdentityId,
  newWakeId,
  priceFor,
  resolveModel,
  signatureOf,
  stableStringify,
  tagForRun,
  truncate,
  type Agent,
  type Effort,
  type Finding,
  type Identity,
  type IdentityProvider,
  type JsonObject,
  type JsonValue,
  type Memory,
  type PopulaceConfig,
  type Store,
  type ToolCallRecord,
  type Usage,
  type Wake,
  type WakeStatus,
  ZERO_USAGE,
} from "@populace/core";
import type { z } from "zod";
import { WakeBudget, dailyCeilingBreached, killSwitchReason } from "./guardrails.js";
import { McpSession, type TargetTool } from "./mcp/session.js";
import { isRetryableJsonError } from "./model/anthropic.js";
import type { ModelProvider, ModelRequest } from "./model/provider.js";
import { describeTargetTools, personaSystemPrompt, systemBlocks, wakeContextMessage } from "./prompt.js";
import {
  DoneInput,
  FetchPageInput,
  FileFindingInput,
  GiveUpInput,
  RememberInput,
  isReporterTool,
  reporterTools,
} from "./reporter/tools.js";
import { TraceWriter } from "./trace.js";
import { fetchPageText } from "./web-fetch.js";

export interface WakeDeps {
  store: Store;
  provider: ModelProvider;
  identityProvider: IdentityProvider;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface WakeOptions {
  agent: Agent;
  config: PopulaceConfig;
  effort?: Effort;
}

export interface WakeResult {
  wake: Wake;
  agent: Agent;
  findings: Finding[];
  memory: Memory;
  identity: Identity | null;
  /** True when a guardrail stopped the wake before any model call. */
  skipped: boolean;
}

type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

interface FindingDraft {
  kind: Finding["kind"];
  title: string;
  description: string;
  expected: string;
  observed: string;
  severity: Finding["severity"];
  confidence: number;
  tool: string | null;
  evidence: string[];
}

/** Every content block carries `cache_control` except these three, so a breakpoint cannot land on them. */
type CacheableBlockParam = Extract<Anthropic.Beta.BetaContentBlockParam, { cache_control?: Anthropic.Beta.BetaCacheControlEphemeral | null }>;
const UNCACHEABLE_BLOCKS = new Set(["thinking", "redacted_thinking", "fallback"]);

function isCacheable(block: Anthropic.Beta.BetaContentBlockParam): block is CacheableBlockParam {
  return !UNCACHEABLE_BLOCKS.has(block.type);
}

/**
 * Moves the conversation's cache breakpoint to the end of the history.
 *
 * The stable prefix (system prompt, tool list) carries its own breakpoints, but `messages`
 * grows every turn and without a breakpoint on it the whole transcript is re-sent as fresh
 * input each time: uncached input was ~70% of a wake's cost, rising with the square of the
 * session length. One rolling breakpoint means each turn reads the previous turn's prefix at
 * the cache rate instead. Older breakpoints are cleared first so the request stays within the
 * four the API allows (the system block and the last tool hold two of them).
 */
function rollCacheBreakpoint(messages: Anthropic.Beta.BetaMessageParam[]): void {
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) if (isCacheable(block)) block.cache_control = null;
  }
  const last = messages[messages.length - 1];
  if (!last) return;
  // A string body cannot carry cache_control; the block form is equivalent on the wire.
  if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
  const tail = last.content.findLast(isCacheable);
  if (tail) tail.cache_control = { type: "ephemeral" };
}

const WRAP_UP_NOTICE =
  "[runner notice] Your session budget is used up. Do not call any more product tools. If there is anything future-you should know, call remember now, then call done. This is your last turn.";

function toJson(value: object): JsonValue {
  // eslint-disable-next-line no-restricted-syntax -- SDK response objects are plain data; re-parsed through the JSON schema.
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value)) as unknown);
}

function lastUserText(messages: Anthropic.Beta.BetaMessageParam[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return truncate(last.content, 2000);
  return truncate(
    last.content
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_result") return `[tool_result ${block.tool_use_id}] ${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`;
        return `[${block.type}]`;
      })
      .join("\n"),
    2000,
  );
}

/**
 * Runs one wake: a stateless job (ADR-0003). Loads memory and identity, runs one
 * session against the target, persists memory, trace, findings and cost, returns.
 */
export async function runWake(options: WakeOptions, deps: WakeDeps): Promise<WakeResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const { store, provider, identityProvider } = deps;
  const { config } = options;
  let agent: Agent = { ...options.agent };
  const runId = agent.runId;
  const tag = tagForRun(runId);
  const wakeId = newWakeId();
  const wakeNumber = agent.wakeCount + 1;
  const startedAt = now();
  // Persona overrides layer over the global model block, so one population can mix models.
  const modelConfig = resolveModel(config.model, agent.persona.model);
  const effort = options.effort ?? modelConfig.effort;
  const price = priceFor(modelConfig.model, modelConfig.prices);

  const wake: Wake = {
    id: wakeId,
    runId,
    tag,
    agentId: agent.id,
    personaId: agent.persona.id,
    populationId: agent.populationId,
    wakeNumber,
    status: "running",
    summary: "",
    model: modelConfig.model,
    effort,
    usage: ZERO_USAGE,
    costUsd: 0,
    turns: 0,
    toolCalls: 0,
    findingCount: 0,
    wouldReturn: null,
    error: null,
    startedAt: startedAt.toISOString(),
    endedAt: null,
  };

  const findings: Finding[] = [];
  let memory: Memory = (await store.getMemory(runId, agent.id)) ?? emptyMemory(runId, agent.id, startedAt);
  // An identity a sweep has already torn down is an account that no longer exists on the target,
  // so it counts as ABSENT and the agent provisions a new one. A carry-forward from a swept
  // ephemeral execution copies the parent's `identityId` onto its agents, and without this the
  // child run spends its whole budget authenticating as deleted accounts and never signs up.
  const stored = agent.identityId ? ((await store.getIdentity(agent.identityId)) ?? null) : null;
  let identity: Identity | null = stored?.tornDownAt === null ? stored : null;

  const trace = new TraceWriter(store, wakeId, now);
  await store.saveWake(wake);
  await trace.write({ type: "wake.start", agentId: agent.id, personaId: agent.persona.id, runId, wakeNumber });

  const finish = async (status: WakeStatus, summary: string, budget: WakeBudget | null, error: string | null = null): Promise<WakeResult> => {
    const snapshot = budget?.snapshot ?? { usage: ZERO_USAGE, costUsd: 0, turns: 0 };
    const ended = now();
    Object.assign(wake, {
      status,
      summary,
      usage: snapshot.usage,
      costUsd: snapshot.costUsd,
      turns: snapshot.turns,
      findingCount: findings.length,
      error,
      endedAt: ended.toISOString(),
    });
    await trace.write({ type: "wake.end", status, summary, usage: snapshot.usage, costUsd: snapshot.costUsd, turns: snapshot.turns, toolCalls: wake.toolCalls });
    await store.saveWake(wake);
    await store.saveMemory(memory);
    const skipped = snapshot.turns === 0 && (status === "killed" || status === "budget-exceeded");
    if (!skipped) {
      agent = { ...agent, wakeCount: wakeNumber, lastWakeAt: ended.toISOString(), identityId: identity?.id ?? null };
      // give_up means "for good". Without this the agent wakes again on cadence, re-files the
      // same abandonment, and reads memory from a session where it decided to leave.
      if (status === "gave-up") agent = { ...agent, status: "retired", retiredReason: "gave-up", nextWakeAt: null };
    } else {
      agent = { ...agent, identityId: identity?.id ?? null };
    }
    await store.upsertAgent(agent);
    log(`[wake ${wakeId}] ${agent.id} #${wakeNumber} ${status} turns=${snapshot.turns} cost=$${snapshot.costUsd.toFixed(4)} findings=${findings.length}${error ? ` error=${error}` : ""}`);
    return { wake, agent, findings, memory, identity, skipped };
  };

  // ---- pre-flight guardrails -------------------------------------------
  const killed = await killSwitchReason(store);
  if (killed) {
    await trace.write({ type: "guardrail", rule: "kill-switch", detail: killed });
    return finish("killed", killed, null);
  }
  const daily = await dailyCeilingBreached(store, agent.populationId, config.guardrails.dailyUsd, startedAt);
  if (daily) {
    await trace.write({ type: "guardrail", rule: "daily-usd", detail: daily });
    return finish("budget-exceeded", daily, null);
  }

  // ---- identity ----------------------------------------------------------
  let signup: { tool: string; email: string; displayName: string; password: string } | null = null;
  if (!identity) {
    const provisioned = await identityProvider.provision({ agent, runId, tag });
    if (provisioned.kind === "credential") {
      identity = {
        id: newIdentityId(),
        runId,
        tag,
        agentId: agent.id,
        personaId: agent.persona.id,
        strategy: identityProvider.strategy,
        credential: provisioned.credential,
        createdAt: now().toISOString(),
        tornDownAt: null,
      };
      await store.saveIdentity(identity);
      agent = { ...agent, identityId: identity.id };
      await store.upsertAgent(agent);
      await trace.write({ type: "identity", event: "provisioned", strategy: identityProvider.strategy, detail: provisioned.credential.email ?? provisioned.credential.userId ?? "credential" });
    } else {
      signup = { tool: provisioned.signupTool, ...provisioned.suggested };
      await trace.write({ type: "identity", event: "missing", strategy: identityProvider.strategy, detail: `agent may sign up via ${provisioned.signupTool} as ${provisioned.suggested.email}` });
    }
  }

  // ---- connect -----------------------------------------------------------
  const sessions = new Map<string, McpSession>();
  for (const endpoint of config.target.mcp) sessions.set(endpoint.name, new McpSession(endpoint, identity?.credential.bearerToken));
  try {
    for (const session of sessions.values()) await session.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const session of sessions.values()) await session.close();
    return finish("error", `could not connect to target: ${message}`, null, message);
  }

  const multi = sessions.size > 1;
  const targetTools: { key: string; tool: TargetTool; session: McpSession }[] = [];
  for (const session of sessions.values()) {
    for (const tool of session.listTools()) {
      const key = multi ? `${session.endpoint.name}__${tool.name}` : tool.name;
      if (!isToolAllowed(tool.name, agent.persona.tools.allow, agent.persona.tools.deny)) continue;
      targetTools.push({ key, tool, session });
    }
  }
  targetTools.sort((a, b) => a.key.localeCompare(b.key));
  const targetByKey = new Map(targetTools.map((t) => [t.key, t]));

  const webBaseUrl = config.guardrails.webFetch ? config.target.webBaseUrl : undefined;
  const modelTools: Anthropic.Beta.BetaTool[] = [
    ...targetTools.map(({ key, tool }) => ({
      name: key,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    })),
    ...reporterTools({ webFetch: webBaseUrl !== undefined }),
  ];
  const lastTool = modelTools[modelTools.length - 1];
  if (lastTool) lastTool.cache_control = { type: "ephemeral" };

  const systemText = `${personaSystemPrompt(agent, config.target)}\n\nThe product exposes these tools:\n${describeTargetTools(targetTools.map((t) => ({ ...t.tool, name: t.key })))}`;
  const system = systemBlocks(systemText);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: wakeContextMessage({ agent, wakeNumber, now: startedAt, memory, identity, signup, maxTurns: config.guardrails.perWake.maxTurns, webBaseUrl }),
    },
  ];

  const budget = new WakeBudget(config.guardrails.perWake);
  const callLog: ToolCallRecord[] = [];
  const pendingConfirm = new Set<string>();
  let callCounter = 0;
  let wrapUp = false;
  let nudged = false;
  let ended: { status: WakeStatus; summary: string } | null = null;
  let jsonRetries = 0;

  const resolveEvidence = (refs: string[]): ToolCallRecord[] => {
    const byRef = new Map(callLog.map((r) => [r.ref, r]));
    const picked = refs.map((r) => byRef.get(r.trim().replace(/^\[|\]$/g, ""))).filter((r): r is ToolCallRecord => r !== undefined);
    if (picked.length > 0) return picked.sort((a, b) => a.traceSeq - b.traceSeq);
    return callLog.slice(-5);
  };

  const fileFinding = async (input: FindingDraft): Promise<Finding> => {
    const reproduction = resolveEvidence(input.evidence);
    const endpoint = reproduction[reproduction.length - 1]?.endpoint ?? config.target.mcp[0]?.name ?? "default";
    // The signature is computed here, at file time, from the same (kind, primary tool, title
    // tokens) the digest clusters on. Computing it now is what makes "this problem, across every
    // execution of this simulation" a lookup rather than a re-clustering (ADR-0028).
    const primaryTool = input.tool ?? reproduction[reproduction.length - 1]?.tool ?? "";
    const finding: Finding = {
      id: newFindingId(),
      runId,
      tag,
      wakeId,
      agentId: agent.id,
      personaId: agent.persona.id,
      signature: signatureOf(input.kind, primaryTool, input.title),
      kind: input.kind,
      title: input.title,
      description: input.description,
      expected: input.expected,
      observed: input.observed,
      severity: input.severity,
      confidence: input.confidence,
      ...(input.tool ? { tool: input.tool } : {}),
      reproduction,
      endpoint,
      identityId: identity?.id ?? null,
      verification: null,
      createdAt: now().toISOString(),
    };
    await store.saveFinding(finding);
    findings.push(finding);
    wake.findingCount = findings.length;
    await trace.write({ type: "finding", findingId: finding.id, kind: finding.kind, title: finding.title });
    return finding;
  };

  const recordCall = async (endpoint: string, tool: string, args: JsonValue, result: ToolCallRecord["result"], latencyMs: number): Promise<ToolCallRecord> => {
    const ref = `c${++callCounter}`;
    const event = await trace.write({ type: "tool.call", ref, endpoint, tool, arguments: args, result, latencyMs });
    const record: ToolCallRecord = { ref, endpoint, tool, arguments: args, result, latencyMs, traceSeq: event.seq, at: event.at };
    callLog.push(record);
    wake.toolCalls = callLog.length;
    return record;
  };

  const shown = (ref: string, text: string): string => `[${ref}] ${truncate(text, config.guardrails.maxToolResultChars)}`;

  const handleTargetTool = async (block: Anthropic.Beta.BetaToolUseBlock, entry: { key: string; tool: TargetTool; session: McpSession }): Promise<ToolResultParam> => {
    const parsedArgs = JsonObjectSchema.safeParse(block.input);
    if (!parsedArgs.success) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `INVALID_JSON: arguments for ${entry.key} were not a JSON object` };
    }
    const args: JsonObject = parsedArgs.data;
    if (wrapUp) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: "Session budget is used up; product tools are closed. Call remember and done." };
    }
    if (entry.tool.destructive) {
      const policy = agent.persona.tools.destructive;
      if (policy === "deny") {
        await trace.write({ type: "guardrail", rule: "destructive-denied", tool: entry.tool.name, detail: "destructive tool denied by persona policy" });
        return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `${entry.key} is a destructive action and you have decided never to do destructive things here.` };
      }
      if (policy === "confirm") {
        const key = stableStringify({ tool: entry.key, args });
        if (!pendingConfirm.has(key)) {
          pendingConfirm.add(key);
          await trace.write({ type: "guardrail", rule: "destructive-confirm", tool: entry.tool.name, detail: "first call to a destructive tool; asked for confirmation" });
          return {
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `${entry.key} is marked as destructive (${entry.tool.description}). If you really mean it, call it again with exactly the same arguments to confirm.`,
          };
        }
      }
    }
    const outcome = await entry.session.call(entry.tool.name, args);
    const record = await recordCall(entry.session.endpoint.name, entry.tool.name, args, outcome.result, outcome.latencyMs);

    if (!identity && signup && entry.tool.name === signup.tool && !outcome.result.isError && identityProvider.capture) {
      const credential = identityProvider.capture({ tool: entry.tool.name, arguments: args, result: outcome.data });
      if (credential) {
        identity = {
          id: newIdentityId(),
          runId,
          tag,
          agentId: agent.id,
          personaId: agent.persona.id,
          strategy: identityProvider.strategy,
          credential: { ...credential, email: credential.email ?? signup.email, displayName: credential.displayName ?? signup.displayName },
          createdAt: now().toISOString(),
          tornDownAt: null,
        };
        await store.saveIdentity(identity);
        agent = { ...agent, identityId: identity.id };
        await store.upsertAgent(agent);
        await trace.write({ type: "identity", event: "captured", strategy: identityProvider.strategy, detail: identity.credential.email ?? identity.credential.userId ?? "credential" });
        for (const session of sessions.values()) await session.reconnectWith(credential.bearerToken);
        await trace.write({ type: "identity", event: "reconnected", strategy: identityProvider.strategy, detail: "MCP sessions reconnected with the new bearer token" });
      }
    }
    return { type: "tool_result", tool_use_id: block.id, is_error: outcome.result.isError, content: shown(record.ref, outcome.result.text) };
  };

  const reporterResult = async (block: Anthropic.Beta.BetaToolUseBlock, accepted: boolean, text: string): Promise<ToolResultParam> => {
    await trace.write({ type: "reporter.call", tool: block.name, arguments: toJson(block.input as object), result: text, accepted });
    return { type: "tool_result", tool_use_id: block.id, is_error: !accepted, content: text };
  };

  const invalid = (block: Anthropic.Beta.BetaToolUseBlock, error: z.ZodError): Promise<ToolResultParam> =>
    reporterResult(block, false, `INVALID_JSON: ${block.name} arguments did not validate: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);

  const handleReporterTool = async (block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolResultParam> => {
    switch (block.name) {
      case "file_finding": {
        const parsed = FileFindingInput.safeParse(block.input);
        if (!parsed.success) return invalid(block, parsed.error);
        const f = await fileFinding({ ...parsed.data, evidence: parsed.data.evidence_calls });
        return reporterResult(block, true, `Filed ${f.kind} ${f.id}: ${f.title} (${f.reproduction.length} evidence calls attached).`);
      }
      case "give_up": {
        const parsed = GiveUpInput.safeParse(block.input);
        if (!parsed.success) return invalid(block, parsed.error);
        const d = parsed.data;
        const f = await fileFinding({
          kind: "abandonment",
          title: d.title,
          description: d.reason,
          expected: "The product keeps this persona.",
          observed: `${d.reason}${d.would_return ? " (would return if fixed)" : " (would not return)"}`,
          severity: d.severity,
          confidence: 0.9,
          tool: null,
          evidence: d.evidence_calls,
        });
        wake.wouldReturn = d.would_return;
        ended = { status: "gave-up", summary: d.reason };
        return reporterResult(block, true, `Recorded that you gave up (${f.id}). Session over.`);
      }
      case "remember": {
        const parsed = RememberInput.safeParse(block.input);
        if (!parsed.success) return invalid(block, parsed.error);
        memory = applyMemoryOperation(memory, parsed.data, wakeNumber, config.guardrails.maxMemoryNotes, now());
        await store.saveMemory(memory);
        await trace.write({ type: "memory", operation: parsed.data.kind, text: parsed.data.text });
        return reporterResult(block, true, `Remembered (${parsed.data.kind}).`);
      }
      case "done": {
        const parsed = DoneInput.safeParse(block.input);
        if (!parsed.success) return invalid(block, parsed.error);
        wake.wouldReturn = parsed.data.would_return;
        ended = { status: "done", summary: `${parsed.data.summary}${parsed.data.would_return ? " (would return)" : " (would not return)"}` };
        return reporterResult(block, true, "Session over. Thanks.");
      }
      case "fetch_page": {
        const parsed = FetchPageInput.safeParse(block.input);
        if (!parsed.success) return invalid(block, parsed.error);
        if (!webBaseUrl) {
          await trace.write({ type: "guardrail", rule: "web-fetch-denied", tool: "fetch_page", detail: "web fetch disabled or no web base url" });
          return reporterResult(block, false, "The website is not available in this session.");
        }
        const page = await fetchPageText(webBaseUrl, parsed.data.path, config.guardrails.maxToolResultChars);
        const text = page.ok ? page.text : page.error;
        const record = await recordCall("web", "fetch_page", { path: parsed.data.path }, { text, isError: !page.ok }, 0);
        return { type: "tool_result", tool_use_id: block.id, is_error: !page.ok, content: shown(record.ref, text) };
      }
      default:
        return reporterResult(block, false, `Unknown reporter tool ${block.name}.`);
    }
  };

  // ---- the loop ----------------------------------------------------------
  try {
    for (;;) {
      const kill = await killSwitchReason(store);
      if (kill) {
        await trace.write({ type: "guardrail", rule: "kill-switch", detail: kill });
        ended = { status: "killed", summary: kill };
        break;
      }

      rollCacheBreakpoint(messages);
      const request: ModelRequest = {
        model: modelConfig.model,
        effort,
        maxTokens: modelConfig.maxTokens,
        system,
        tools: modelTools,
        messages,
        fallbacks: modelConfig.fallbacks,
        metadata: { wakeId, wakeNumber, agentId: agent.id, personaId: agent.persona.id, runId },
      };
      const turn = budget.snapshot.turns + 1;
      let response;
      try {
        response = await provider.complete(request);
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Error && isRetryableJsonError(err) && jsonRetries++ < 2) {
          await trace.write({ type: "note", text: `model turn ${turn} produced unparseable tool input; re-issuing` });
          continue;
        }
        throw err;
      }
      const usage: Usage = response.usage;
      const cost = costOf(usage, price);
      budget.record(usage, cost);
      await trace.write({
        type: "model.call",
        turn,
        model: modelConfig.model,
        effort,
        request: { messageCount: messages.length, lastUserContent: lastUserText(messages) },
        response: { stopReason: response.message.stop_reason, content: toJson(response.message.content), servedBy: response.servedBy },
        usage,
        costUsd: cost,
        latencyMs: response.latencyMs,
      });
      // Append-only history: the assistant turn goes in exactly as produced (thinking blocks included).
      messages.push({ role: "assistant", content: response.message.content });

      const message = response.message;
      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.type === "refusal" ? (message.stop_details.category ?? "unspecified") : "unspecified";
        ended = { status: "error", summary: `model refused (${category})` };
        break;
      }
      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        // Truncated tool input: never run it. Tell the model and let it retry.
        messages.push({ role: "user", content: toolUses.map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, is_error: true, content: "Your tool call was cut off before it finished; call it again more briefly." })) });
        continue;
      }
      if (toolUses.length === 0) {
        if (nudged || wrapUp) {
          const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
          ended = { status: "done", summary: truncate(text || "session ended without a summary", 500) };
          break;
        }
        nudged = true;
        messages.push({ role: "user", content: "[runner notice] The session is still open. Keep going if you have more to do, otherwise call done (or give_up)." });
        continue;
      }

      const results: ToolResultParam[] = [];
      for (const block of toolUses) {
        if (ended) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: "Session already over." });
          continue;
        }
        if (isReporterTool(block.name)) results.push(await handleReporterTool(block));
        else {
          const entry = targetByKey.get(block.name);
          if (!entry) {
            await trace.write({ type: "guardrail", rule: "tool-denied", tool: block.name, detail: "tool not offered in this wake" });
            results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `There is no tool called ${block.name}.` });
          } else results.push(await handleTargetTool(block, entry));
        }
      }
      // All tool results for one assistant turn go back in a single user message.
      messages.push({ role: "user", content: results });
      if (ended) break;

      const breach = budget.breach();
      if (breach) {
        await trace.write({ type: "guardrail", rule: breach.rule, detail: breach.detail });
        if (wrapUp) {
          ended = { status: breach.rule === "max-turns" ? "max-turns" : "budget-exceeded", summary: breach.detail };
          break;
        }
        wrapUp = true;
        messages.push({ role: "user", content: WRAP_UP_NOTICE });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const session of sessions.values()) await session.close();
    return finish("error", `wake failed: ${message}`, budget, message);
  }

  for (const session of sessions.values()) await session.close();
  const final = ended ?? { status: "done" as const, summary: "" };
  return finish(final.status, final.summary, budget);
}
