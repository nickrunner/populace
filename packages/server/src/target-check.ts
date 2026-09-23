import type { IdentityGuess, SignInStatus, TargetCheck, TargetPromises } from "@populace/contract";
import type { IdentityConfig, McpEndpoint } from "@populace/core";
import { McpSession, fetchPageText, type SignInProvider, type TargetTool } from "@populace/runner";
import { z } from "zod";

/**
 * What the check may connect AS, beyond whatever the endpoints themselves carry.
 *
 * `signIn` is the user's own OAuth grant for an address (ADR-0036) and `askAboutSignIn` is what
 * turns a bare failure into "it will not talk to strangers". Both are optional, and a caller that
 * passes neither gets exactly the anonymous check this had before: the runner's wake path is such
 * a caller, and must stay one — a grant is one human's account and not a population's.
 */
export interface CheckCredentials {
  signIn?: (endpoint: McpEndpoint) => SignInProvider | undefined;
  /** What is at the address, asked of the first endpoint that fails. Read-only; registers nothing. */
  askAboutSignIn?: (endpoint: McpEndpoint) => Promise<{ signIn: SignInStatus; reached: TargetCheck["reached"] }>;
}

/**
 * The live connection panel behind the `Connect` screen: does it answer, how fast, what does it
 * expose, and what would have to be true for an agent to sign itself up. Read-only against the
 * target — it lists tools and never calls one.
 */
export async function checkTarget(endpoints: McpEndpoint[], identity?: IdentityConfig, credentials: CheckCredentials = {}): Promise<TargetCheck> {
  const tools: TargetTool[] = [];
  const errors: string[] = [];
  let latencyMs: number | null = null;
  let server: TargetCheck["server"] = null;
  let signIn: SignInStatus | null = null;
  let reached: TargetCheck["reached"] = null;

  for (const endpoint of endpoints) {
    const session = new McpSession(endpoint, undefined, credentials.signIn?.(endpoint));
    const started = Date.now();
    try {
      await session.connect();
      // The first endpoint that answers sets the latency and server line the panel shows.
      latencyMs ??= Date.now() - started;
      server ??= session.serverInfo;
      tools.push(...session.listTools());
    } catch (err) {
      errors.push(`${endpoint.name}: ${err instanceof Error ? err.message : String(err)}`);
      // Why it refused matters more than that it refused. Asked of the FIRST endpoint that fails
      // and no further: one address needing a sign-in is the whole answer the screen can act on,
      // and a second probe of a second dead address tells the reader nothing new.
      if (reached === null && credentials.askAboutSignIn) {
        const asked = await credentials.askAboutSignIn(endpoint);
        reached = asked.reached;
        if (asked.signIn.required) signIn = asked.signIn;
      }
    } finally {
      await session.close();
    }
  }

  return {
    ok: errors.length < endpoints.length,
    checkedAt: new Date().toISOString(),
    latencyMs,
    server,
    tools: tools.map((t) => ({ name: t.name, description: t.description, endpoint: t.endpoint, destructive: t.destructive, readOnly: t.readOnly })),
    // A tool nobody can tell apart from the others is a tool nobody will reach for, which is why
    // this is named on the screen rather than counted.
    undescribed: tools.filter((t) => t.description.trim() === "").map((t) => t.name),
    identity: guessIdentity(tools, identity),
    signIn,
    // Only when the check failed: a connection that worked has nothing to diagnose.
    reached: errors.length === 0 ? null : reached,
    errors,
  };
}

const SIGNUP = /^(sign[_-]?up|register|create[_-]?account|signup)$/i;
const TEARDOWN = /^(delete[_-]?account|close[_-]?account|deregister|remove[_-]?account)$/i;

/**
 * Pre-fills the identity form from the tool list. Every field is a guess with a stated reason and
 * none of it is applied silently: getting `signupTool` wrong means every agent in the run fails to
 * get through the front door, so the user confirms it.
 */
export function guessIdentity(tools: TargetTool[], current?: IdentityConfig): IdentityGuess {
  const because: string[] = [];
  const names = tools.map((t) => t.name);
  const byName = (re: RegExp): string | null => names.find((n) => re.test(n)) ?? null;

  const signupTool = byName(SIGNUP) ?? names.find((n) => /sign.?up|register/i.test(n)) ?? null;
  if (signupTool) because.push(`\`${signupTool}\` looks like the tool that creates an account`);
  else because.push("no tool in the list looks like a sign-up, so an agent cannot make its own account here");

  const teardownTool = byName(TEARDOWN) ?? null;
  if (teardownTool) because.push(`\`${teardownTool}\` looks like the tool that removes one, so sweep can clean up after a run`);
  else because.push("no tool looks like it deletes an account, so accounts this run creates will have to be removed by hand");

  const signup = signupTool === null ? undefined : tools.find((t) => t.name === signupTool);
  const paths = signup ? guessPathsFromSchema(signup) : { tokenPath: null, userIdPath: null };
  if (paths.tokenPath) because.push(`\`${paths.tokenPath}\` is where the token looks like it comes back`);

  // A value the user already saved wins over a guess: this endpoint exists to help fill an empty
  // form, not to argue with a configuration that is already working.
  const existing = current?.strategy === "self-signup" ? current : undefined;
  return {
    signupTool: existing?.signupTool ?? signupTool,
    tokenPath: existing?.tokenPath ?? paths.tokenPath,
    userIdPath: existing?.userIdPath ?? paths.userIdPath,
    teardownTool: existing?.teardownTool ?? teardownTool,
    because,
  };
}

const OutputShapeSchema = z.object({ properties: z.record(z.string(), z.unknown()).optional() }).loose();

/**
 * MCP publishes an input schema, not an output one, so where the token comes back is not knowable
 * from the tool list. The defaults are what the reference target and most self-signup APIs use;
 * they are offered as a starting point and the panel says so.
 */
function guessPathsFromSchema(signup: TargetTool): { tokenPath: string | null; userIdPath: string | null } {
  const parsed = OutputShapeSchema.safeParse(signup.inputSchema);
  const keys = parsed.success ? Object.keys(parsed.data.properties ?? {}) : [];
  return {
    tokenPath: "token",
    // `user.id` is the shape when sign-up echoes the account back, which is the common case when
    // the input asks for a user at all.
    userIdPath: keys.some((k) => /user|account|email/i.test(k)) ? "user.id" : null,
  };
}

const ACTION = /\b(create|add|make|track|organi[sz]e|search|find|share|comment|delete|remove|archive|export|import|assign|schedule|set|update|edit|move|tick|complete|finish|sync|invite|filter|sort|tag|attach|upload|download|remind|notify)\b/i;

/**
 * The website's copy against the tool list. A sentence that promises an action with no tool behind
 * it is a coverage gap found before a visit is spent — the pre-run version of what the digest
 * reports afterwards.
 *
 * Matching is on the *verb and its object*, not on word overlap. Plain overlap reads "Delete tasks
 * you no longer need" as kept by `delete_project`, because both say delete and both say task, and
 * that is the one promise the reference app deliberately does not keep — a matcher that misses it
 * would be worse than none. So a tool keeps a promise when it shares the promise's verb *and*
 * names the same thing, or when its own description says enough about the promise to stand in.
 *
 * It is still a heuristic and the screen presents it as one. It exists to point somewhere; the
 * population is what finds the real gaps.
 */
export async function checkPromises(webBaseUrl: string | null, tools: { name: string; description: string }[]): Promise<TargetPromises> {
  if (!webBaseUrl) return { fetched: false, url: null, error: "no web address is set for this target", promises: [] };
  const page = await fetchPageText(webBaseUrl, "/", 40_000);
  if (!page.ok) return { fetched: false, url: webBaseUrl, error: page.error, promises: [] };

  const vocabulary = tools.map((tool) => {
    // `search_tasks` is (search, task); `get_product_info` is (get, {product, info}).
    const parts = tool.name.split(/[_-]+/).filter(Boolean).map((w) => singular(w.toLowerCase()));
    const verb = parts[0] ?? tool.name.toLowerCase();
    return { name: tool.name, verb, objects: new Set(parts.slice(1)), description: words(tool.description) };
  });

  const seen = new Set<string>();
  const promises: TargetPromises["promises"] = [];
  for (const candidate of candidatePromises(page.text)) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const claim = words(candidate);
    let matched: string | null = null;
    for (const tool of vocabulary) {
      if (!claim.has(tool.verb)) continue;
      // Same verb and the same thing: `create_project` for "Create projects".
      if ([...tool.objects].some((object) => claim.has(object))) {
        matched = tool.name;
        break;
      }
      // Same verb, different noun: only stands in when the tool's own description says enough
      // about this promise on its own. Two words beyond the verb is the line between
      // "Search your tasks… on title and notes" answering "search across titles and notes", and
      // `delete_project` answering "delete tasks".
      const support = [...claim].filter((word) => word !== tool.verb && tool.description.has(word)).length;
      if (support >= 2) matched = tool.name;
    }
    promises.push({ text: candidate, kept: matched !== null, matchedTool: matched });
    if (promises.length >= 40) break;
  }
  return { fetched: true, url: webBaseUrl, error: null, promises };
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "your", "you", "our", "is", "are", "it", "that", "this", "all", "any", "them", "they", "can", "will", "at", "by", "from", "up", "out", "no", "not", "one", "just", "get", "have", "has"]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(singular),
  );
}

/** Crude but enough to match "Delete tasks" against a `delete_task` tool. */
function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("ches") || word.endsWith("shes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Bullet items and short action sentences: the shapes product copy states a promise in. */
function candidatePromises(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/^[-*•]\s*/, "").trim();
    if (trimmed.length < 8) continue;
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const claim = sentence.trim().replace(/[.!?]+$/, "");
      if (claim.length < 8 || claim.length > 140) continue;
      if (!ACTION.test(claim)) continue;
      out.push(claim);
    }
  }
  return out;
}
