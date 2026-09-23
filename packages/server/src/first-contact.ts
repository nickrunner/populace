import { identityProviderFor } from "@populace/adapters";
import {
  PersonaSchema,
  blockedBecause,
  effectiveToolPolicy,
  isToolPermitted,
  newIdentityId,
  type Agent,
  type Credential,
  type EffectiveToolPolicy,
  type FirstContact,
  type Identity,
  type IdentityProvider,
  type JsonValue,
  type StoredTarget,
  type TeardownDeps,
} from "@populace/core";
import { McpSession, looksLikeAuthRejection, type TargetTool } from "@populace/runner";
import { z } from "zod";

/**
 * "Does my identity configuration actually work?" — answered by doing it, once, for real, and for
 * nothing.
 *
 * The question that motivated this has no answer from inside the forms: a Firebase-authenticated
 * MCP server either accepts an ID token its own project issued or it does not, and the only way to
 * find out used to be to configure everything, start a run, spend money and read a confusing
 * failure. So: provision ONE identity through the configured strategy, make ONE read-only call
 * with it, take the account back down, and say precisely which of the four things happened.
 *
 * Three properties matter more than the feature.
 *
 * It calls no model. Not one token of Anthropic spend, whatever the outcome — the whole point is
 * that a user can run it before they have decided to spend anything.
 *
 * It never writes. The tool it tries is one the target itself annotated `readOnlyHint`, filtered
 * through the target's own tool policy, and with no required arguments; when nothing qualifies it
 * says it verified the connection and did not call anything rather than reaching for something
 * that might have effects.
 *
 * It cleans up. The account it makes is torn down through the same provider that made it, and
 * when the provider cannot remove it (a static pool it never owned, a self-signup target with no
 * teardown tool) the result SAYS an account was left and names it. Nobody's product is quietly
 * left holding a user populace made.
 */

/** A first-contact run is one person, and this is who they are: nobody, deliberately and visibly. */
const PROBE_PERSONA = PersonaSchema.parse({
  id: "first-contact",
  name: "First contact",
  role: "a check, not a person",
  backstory: "Exists for one call and is then removed.",
  goals: ["prove that an account can be made and used here"],
});

/**
 * The tag on the probe account. It is deliberately NOT `tagForRun(...)` of a made-up run id: a
 * sweep looks for identities by run tag, and a probe that borrowed one would be swept as though it
 * belonged to an execution that never happened.
 */
export const FIRST_CONTACT_TAG = "populace:first-contact";

/** The one participant a check ever has. Not a run's agent id: no run exists and none is invented. */
const PROBE_AGENT_ID = "first-contact/probe#1";

function probeAgent(at: Date): Agent {
  const stamp = at.getTime().toString(36);
  return {
    id: PROBE_AGENT_ID,
    runId: FIRST_CONTACT_TAG,
    simulationId: "first-contact",
    populationId: "first-contact",
    cohortSlug: "probe",
    personId: "probe#1",
    name: "First contact",
    details: "",
    // Unique per check, so a target that refuses a duplicate email does not report the SECOND
    // check as a provisioning failure caused by the first.
    handle: `populace-check-${stamp}`,
    persona: PROBE_PERSONA,
    ordinal: 0,
    status: "active",
    retiredReason: null,
    continuedFrom: null,
    identityId: null,
    wakeCount: 0,
    maxWakes: null,
    nextWakeAt: null,
    lastWakeAt: null,
    createdAt: at.toISOString(),
  };
}

export interface FirstContactOptions {
  /** Injected by tests; production resolves the provider from the target's own identity block. */
  identityProvider?: IdentityProvider;
  now?: () => Date;
}

/** A tool's input schema, only as far as "can this be called with no arguments at all". */
const InputShapeSchema = z.object({ required: z.array(z.string()).optional() }).loose();

function takesNoArguments(tool: TargetTool): boolean {
  const parsed = InputShapeSchema.safeParse(tool.inputSchema);
  return parsed.success && (parsed.data.required ?? []).length === 0;
}

/**
 * The tool to try, or WHY there is none.
 *
 * A candidate is read-only by the target's OWN annotation, permitted by the target's tool policy,
 * and callable with no arguments — a "read-only" tool called without its required id answers with
 * a validation error, which would read as a broken identity when it is nothing of the kind.
 * Sorted by name so the same target always answers through the same tool and two checks are
 * comparable.
 *
 * The three reasons are kept apart because they send the reader somewhere different: one says go
 * and annotate your tools, one says widen the allowlist you just wrote on this very screen, and
 * one says nothing is wrong at all. Collapsing them into "nothing is marked read-only" sends two
 * of the three users off to fix something that is not broken.
 */
type ReadOnlyCandidate = { tool: TargetTool; why: null } | { tool: null; why: string };

function readOnlyCandidate(tools: readonly TargetTool[], policy: EffectiveToolPolicy): ReadOnlyCandidate {
  const readOnly = tools.filter((tool) => tool.readOnly && !tool.destructive);
  if (readOnly.length === 0) return { tool: null, why: "nothing here is marked read-only, so no tool was called" };
  const permitted = readOnly.filter((tool) => isToolPermitted(tool.name, policy));
  if (permitted.length === 0) return { tool: null, why: "every read-only tool here is blocked by the target's own tool policy, so no tool was called" };
  const callable = permitted.filter(takesNoArguments).sort((a, b) => a.name.localeCompare(b.name));
  const first = callable[0];
  if (!first) return { tool: null, why: "every read-only tool here needs arguments, and calling one without them would fail for reasons that have nothing to do with the account, so no tool was called" };
  return { tool: first, why: null };
}

/** The account handle, exactly as the rest of the product reports one: an email or a user id, never a token. */
function handleOf(credential: Credential): string {
  return credential.email ?? credential.userId ?? "(an account with no handle)";
}

/**
 * Every secret this check could possibly quote, collected as it becomes known and removed from
 * anything reported, logged or stored.
 *
 * It is seeded from the CONFIGURATION rather than only from the credential, and it is seeded
 * before the first connection, because the leak that motivated this was neither: a gateway that
 * answers 401 with the Authorization header it received puts the target's own endpoint token into
 * an `unreachable` detail, before an account exists and before anything the provider knows about.
 * That detail is then written onto the target row and rendered in the editor. So: configured
 * endpoint tokens, configured header values, the Firebase Web API key, the password the check
 * offers a sign-up tool, and the credential's bearer and redeemable once there is one.
 *
 * Header values are taken as credential material wholesale. A header somebody typed into a
 * target's endpoint settings is an auth header far more often than it is anything else, and
 * "[redacted]" where a content type used to be is a cosmetic loss against a real leak.
 */
class Secrets {
  private readonly known: string[] = [];

  /** Short strings are ignored: they are not credentials and they appear inside ordinary words. */
  add(...values: readonly (string | undefined)[]): void {
    for (const value of values) if (typeof value === "string" && value.length >= 8) this.known.push(value);
  }

  redact(text: string): string {
    return this.known.reduce((acc, secret) => acc.split(secret).join("[redacted]"), text);
  }
}

/**
 * Runs the check. Never throws for a target's misbehaviour: every way this can go wrong is one of
 * the outcomes, because "it threw" is the answer the user already had.
 */
export async function firstContact(target: StoredTarget, options: FirstContactOptions = {}): Promise<FirstContact> {
  const now = options.now ?? (() => new Date());
  const at = now();
  const checkedAt = at.toISOString();
  // Built first, because building it can itself fail — a static pool file that is not there, an
  // admin SDK that is not installed — and because the STRATEGY it reports is the one that actually
  // provisioned. The failure is held rather than thrown: an unreachable endpoint is the more
  // fundamental problem and is still reported first when both are broken.
  let provider: IdentityProvider | null = null;
  let providerError: string | null = null;
  try {
    provider = options.identityProvider ?? identityProviderFor(target.identity);
  } catch (err) {
    providerError = (err instanceof Error ? err.message : String(err));
  }
  const strategy = provider?.strategy ?? target.identity.strategy;
  // The FIRST endpoint. A target with several is one product behind several addresses, and the
  // question here is whether a person can get an account and use it — one door is enough to answer
  // it, and provisioning once per endpoint would make several accounts to check one thing.
  const endpoint = target.mcp[0];
  if (!endpoint) {
    return { outcome: "unreachable", checkedAt, strategy, summary: "This target has no MCP address, so there was nothing to contact.", detail: null, handle: null, tool: null, latencyMs: null, tornDown: false, leftBehind: null };
  }

  // Seeded before anything is connected, so that even the first failure — whose detail is a
  // stranger's HTTP body — cannot carry a configured token out to the target row and the screen.
  const secrets = new Secrets();
  secrets.add(endpoint.bearerToken, ...Object.values(endpoint.headers));
  if (target.identity.strategy === "admin-mint") secrets.add(target.identity.apiKey);

  /**
   * The only way out of this function from here on — everything above it is words this file wrote
   * itself. Everything that came out of somebody else's code — a provider, an SDK, an HTTP body,
   * the reason an account could not be removed — goes through the redactor on its way to a
   * response that is persisted on the target row and rendered in the UI.
   */
  const report = (result: FirstContact): FirstContact => ({
    ...result,
    summary: secrets.redact(result.summary),
    detail: result.detail === null ? null : secrets.redact(result.detail),
    leftBehind: result.leftBehind === null ? null : { handle: result.leftBehind.handle, why: secrets.redact(result.leftBehind.why) },
  });

  // What anybody sent here may touch. The check obeys it too: a tool this policy blocks is a tool
  // no agent can reach, so a check that used one would be answering a different question.
  const policy = effectiveToolPolicy(target.tools);

  // ---- 1. can it be reached at all ----------------------------------------
  // Before any account exists, so "your server is down" is never reported as "your identity
  // configuration is wrong". This connection uses the endpoint's own token (a gateway token), not
  // a person's — the same thing `checkTarget` does.
  const anonymous = new McpSession(endpoint, undefined);
  const started = Date.now();
  try {
    await anonymous.connect();
  } catch (err) {
    await anonymous.close();
    return report({
      outcome: "unreachable",
      checkedAt,
      strategy,
      summary: `Could not reach ${endpoint.url}. Nothing was created and nothing was tried.`,
      detail: (err instanceof Error ? err.message : String(err)),
      handle: null,
      tool: null,
      latencyMs: null,
      tornDown: false,
      leftBehind: null,
    });
  }
  const reachLatency = Date.now() - started;
  const anonymousTools = anonymous.listTools();

  // ---- 2. provision one identity ------------------------------------------
  if (provider === null) {
    await anonymous.close();
    return report({
      outcome: "provision-failed",
      checkedAt,
      strategy,
      summary: provisionFailureSummary(strategy, null),
      detail: providerError,
      handle: null,
      tool: null,
      latencyMs: reachLatency,
      tornDown: false,
      leftBehind: null,
    });
  }
  const ready: IdentityProvider = provider;
  let credential: Credential | null;
  try {
    credential = await provisionOne(ready, probeAgent(at), anonymous, anonymousTools, policy, secrets);
  } catch (err) {
    await anonymous.close();
    // The sign-up tool may already have answered before this failed — a `tokenPath` that points at
    // nothing is the likeliest configuration mistake there is, and by then the account is on
    // somebody's product. There is no credential to authenticate a teardown call with, so it
    // cannot be removed; the one thing that must not happen is saying nothing was left behind.
    const created = err instanceof ProvisionFailed ? err.created : null;
    return report({
      outcome: "provision-failed",
      checkedAt,
      strategy,
      summary: err instanceof ProvisionFailed && err.summary !== null ? err.summary : provisionFailureSummary(strategy, created),
      detail: (err instanceof Error ? err.message : String(err)),
      handle: created,
      tool: null,
      latencyMs: reachLatency,
      tornDown: false,
      leftBehind: created === null ? null : { handle: created, why: "the sign-up tool made it before this failed, and no credential came back to authenticate a deletion with, so populace could not remove it — delete it by hand" },
    });
  }

  // ---- 2a. nobody needs an account here ------------------------------------
  // The provider said there is no account and there will not be one (ADR-0038), so the session
  // already open IS the session a person would have: whatever the address itself carries. Every
  // sentence below about a handle, a teardown and what was left behind has nothing to answer, and
  // "an account was made" would be a lie. What is left is the same vocabulary minus
  // `provision-failed`, which cannot happen when nothing is provisioned.
  if (credential === null) {
    const candidate = readOnlyCandidate(anonymousTools, policy);
    if (candidate.tool === null) {
      await anonymous.close();
      return report({
        outcome: "connected-only",
        checkedAt,
        strategy,
        summary: `Nobody needs an account here, and ${endpoint.url} answered — but ${candidate.why}. The connection is verified; a call is not.`,
        detail: null,
        handle: null,
        tool: null,
        latencyMs: reachLatency,
        tornDown: false,
        leftBehind: null,
      });
    }
    const anonymousCall = await anonymous.call(candidate.tool.name, {});
    await anonymous.close();
    const tried = candidate.tool.name;
    if (!anonymousCall.result.isError) {
      return report({
        outcome: "accepted",
        checkedAt,
        strategy,
        summary: `Nobody needs an account here, and \`${tried}\` answered. Everyone a simulation sends will visit exactly as this did.`,
        detail: null,
        handle: null,
        tool: tried,
        latencyMs: anonymousCall.latencyMs,
        tornDown: false,
        leftBehind: null,
      });
    }
    // The failure this branch exists to name, which has two causes and says both. Either the
    // ADDRESS is gated and the token on the endpoint is missing or wrong — the gateway case — or
    // this product does have users and "they don't need one" is the wrong answer. Nobody's
    // account was refused either way, because nobody has one.
    if (looksLikeAuthRejection(anonymousCall.result.text)) {
      return report({
        outcome: "rejected",
        checkedAt,
        strategy,
        summary: `Nobody needs an account here, but \`${tried}\` was refused anyway. Either this address wants a credential of its own — which goes on the endpoint, where every person will use it — or this product does have users after all, and one of the other ways in is the answer.`,
        detail: anonymousCall.result.text,
        handle: null,
        tool: tried,
        latencyMs: anonymousCall.latencyMs,
        tornDown: false,
        leftBehind: null,
      });
    }
    return report({
      outcome: "tool-failed",
      checkedAt,
      strategy,
      summary: `Nobody needs an account here and the target ran the call — but \`${tried}\` answered with an error. Getting in is fine; that tool is not.`,
      detail: anonymousCall.result.text,
      handle: null,
      tool: tried,
      latencyMs: anonymousCall.latencyMs,
      tornDown: false,
      leftBehind: null,
    });
  }

  await anonymous.close();

  secrets.add(credential.bearerToken, credential.redeemable?.secret);
  const handle = handleOf(credential);
  const identity: Identity = {
    id: newIdentityId(),
    runId: FIRST_CONTACT_TAG,
    tag: FIRST_CONTACT_TAG,
    agentId: PROBE_AGENT_ID,
    personaId: PROBE_PERSONA.id,
    strategy,
    credential,
    createdAt: checkedAt,
    tornDownAt: null,
  };

  // Whatever happens from here, the account exists and has to be dealt with, so every return below
  // goes through this.
  const done = async (result: Omit<FirstContact, "tornDown" | "leftBehind">): Promise<FirstContact> => {
    const cleanup = await tearDown(ready, identity, endpoint, handle);
    return report({ ...result, ...cleanup });
  };

  // ---- 3. does the target accept the credential ----------------------------
  const bearer = credential.bearerToken;
  if (bearer === undefined) {
    return done({
      outcome: "provision-failed",
      checkedAt,
      strategy,
      summary: `An account was made (${handle}) but it came back with no token, so there is nothing to present to the target.`,
      detail: null,
      handle,
      tool: null,
      latencyMs: reachLatency,
    });
  }

  const session = new McpSession(endpoint, bearer);
  const callStarted = Date.now();
  try {
    await session.connect();
  } catch (err) {
    await session.close();
    const detail = (err instanceof Error ? err.message : String(err));
    // A Firebase-authenticated server enforces the bearer at the HTTP layer, so a refused token
    // fails `initialize` rather than a tool call. That is exactly the Stays question, and it is
    // the one place the outcome has to be spelled out rather than left to be inferred.
    return done(
      looksLikeAuthRejection(detail)
        ? { outcome: "rejected", checkedAt, strategy, summary: rejectedSummary(strategy, handle, "when the session opened"), detail, handle, tool: null, latencyMs: null }
        : { outcome: "unreachable", checkedAt, strategy, summary: `The account ${handle} was made, but the target stopped answering when it tried to connect with it.`, detail, handle, tool: null, latencyMs: null },
    );
  }

  // ---- 4. one read-only call ----------------------------------------------
  const candidate = readOnlyCandidate(session.listTools(), policy);
  if (candidate.tool === null) {
    await session.close();
    return done({
      outcome: "connected-only",
      checkedAt,
      strategy,
      summary: `The account ${handle} was made and the target accepted it on connect, but ${candidate.why}. The connection is verified; a call is not.`,
      detail: null,
      handle,
      tool: null,
      latencyMs: Date.now() - callStarted,
    });
  }
  const tool = candidate.tool;

  const outcome = await session.call(tool.name, {});
  await session.close();
  const latencyMs = outcome.latencyMs;
  if (!outcome.result.isError) {
    return done({
      outcome: "accepted",
      checkedAt,
      strategy,
      summary: `The account ${handle} was made, the target accepted it, and \`${tool.name}\` answered.`,
      detail: null,
      handle,
      tool: tool.name,
      latencyMs,
    });
  }
  if (looksLikeAuthRejection(outcome.result.text)) {
    return done({
      outcome: "rejected",
      checkedAt,
      strategy,
      summary: rejectedSummary(strategy, handle, `when \`${tool.name}\` was called`),
      detail: outcome.result.text,
      handle,
      tool: tool.name,
      latencyMs,
    });
  }
  return done({
    outcome: "tool-failed",
    checkedAt,
    strategy,
    summary: `The account ${handle} was made and the target accepted its credential — it ran the call — but \`${tool.name}\` answered with an error. The identity is fine; that tool is not.`,
    detail: outcome.result.text,
    handle,
    tool: tool.name,
    latencyMs,
  });
}

/**
 * The words for a refused credential. For admin-mint this has to name the issuer question
 * outright: the user's backend may verify tokens it minted itself and reject a Firebase ID token
 * from this project, and nobody should be expected to infer that from "401".
 */
function rejectedSummary(strategy: FirstContact["strategy"], handle: string, when: string): string {
  const base = `The account ${handle} was made, and the target refused its credential ${when}.`;
  if (strategy === "admin-mint") {
    return `${base} This is the case where the account is real but your backend does not accept this issuer's tokens: it is minting a Firebase ID token for your project, and the product may only accept tokens its own /token endpoint issued. Point identity.exchangeUrl at whatever mints the token your product expects, or make the product verify this issuer.`;
  }
  if (strategy === "static") return `${base} The token in the accounts file is not one this target accepts — it may have expired or belong to another environment.`;
  if (strategy === "provision-url") {
    return `${base} The account exists, so the endpoint made one — but the bearer it handed back is not one this target accepts. The usual cause is an endpoint pointed at a different environment than the address above, or a \`createPerson\` that returns a token the product's own API does not verify.`;
  }
  return `${base} The sign-up worked, so the token is coming back from a different place than \`tokenPath\` points at, or the target does not accept it on other tools.`;
}

/**
 * The words for a failed provisioning. `created` is the account the sign-up tool already made, if
 * it got that far: "nothing was left behind" is only ever said when that is known, because the one
 * unacceptable outcome is an account on somebody's product that nobody was told about.
 */
function provisionFailureSummary(strategy: FirstContact["strategy"], created: string | null): string {
  if (created !== null) {
    return `The sign-up tool made an account (${created}), but no usable credential came back out of it — so the account is ON THE TARGET and populace had nothing to authenticate a deletion with. Delete ${created} by hand, then check the token path against what the sign-up tool actually returns.`;
  }
  switch (strategy) {
    case "self-signup":
      return "The target answered, but no account came out of the sign-up tool. Nothing was left behind.";
    case "static":
      return "The target answered, but no account could be drawn from the accounts file. Nothing was left behind.";
    case "admin-mint":
      return "The target answered, but the admin SDK could not mint an account. Nothing was left behind on the target.";
    case "provision-url":
      // The endpoint is the app's own, so the sentence points at the app rather than at populace:
      // whatever `createPerson` did or refused to do is what a reader has to go and look at.
      return "The target's provisioning endpoint answered, but no account came back out of it. Whether anything was left behind is the endpoint's to say — check what `createPerson` did before it failed.";
    case "none":
      // Reachable only if building the provider itself failed, which for a strategy with no
      // fields and no dependencies it cannot. Written out rather than defaulted, because the
      // `switch` being exhaustive is what names every site the next strategy has to visit.
      return "Nobody needs an account here, so nothing was provisioned and nothing was left behind.";
  }
}

/**
 * A provisioning attempt that failed, carrying the account it may already have made.
 *
 * The distinction this type exists for is the whole difference between an honest result and a lie:
 * "the sign-up call never happened" and "the sign-up call worked and I could not read a token out
 * of it" both surface as a thrown error, and only the second one has left a user on somebody's
 * product.
 */
class ProvisionFailed extends Error {
  constructor(
    message: string,
    /** The handle of an account that now exists on the target, or null when none was made. */
    readonly created: string | null,
    /** A summary that replaces the generic one, when this failure has its own story to tell. */
    readonly summary: string | null = null,
  ) {
    super(message);
    this.name = "ProvisionFailed";
  }
}

/**
 * One identity, through whichever way in is configured.
 *
 * A self-signup provider does not create the account itself — the AGENT does, by calling the
 * target's sign-up tool, and the runner captures what comes back (ADR-0012). So the check does
 * exactly what a person would do on their first visit: it calls that one tool with the values the
 * provider suggested and hands the result to `capture`. That is the configuration being tested —
 * `signupTool` and `tokenPath` are the two fields most likely to be wrong.
 */
async function provisionOne(
  provider: IdentityProvider,
  agent: Agent,
  session: McpSession,
  tools: readonly TargetTool[],
  policy: EffectiveToolPolicy,
  secrets: Secrets,
): Promise<Credential | null> {
  const provisioned = await provider.provision({ agent, runId: FIRST_CONTACT_TAG, tag: FIRST_CONTACT_TAG });
  if (provisioned.kind === "credential") return provisioned.credential;
  // No account, and there will not be one (ADR-0038). Null rather than a credential with nothing
  // in it: a credential with no bearer means "an account was made and came back unusable", which
  // is a failure, and this is the opposite — nothing was asked of anybody.
  if (provisioned.kind === "none") return null;

  const { signupTool, suggested } = provisioned;
  if (!tools.some((tool) => tool.name === signupTool)) {
    throw new ProvisionFailed(`the target exposes no tool called ${signupTool}; the sign-up tool in the identity settings does not match its tool list`, null);
  }
  // The check obeys the same policy a wake does. In `runWake` the sign-up tool reaches the model
  // only through the merged filter, so a target policy that excludes it makes an account
  // unobtainable for every person in the population — and a check that signed up anyway would
  // report "they can get in" for a configuration in which nobody can.
  if (!isToolPermitted(signupTool, policy)) {
    throw new ProvisionFailed(
      `the target's tool policy blocks ${signupTool} (${blockedBecause(signupTool, policy) ?? "blocked"}), so nothing was called`,
      null,
      `The target's own tool policy blocks \`${signupTool}\`, which is the tool an account is made with — so nobody sent here could sign up, and no run would get past its first wake. Allow it in the target's policy, or point identity.signupTool at a tool the policy permits.`,
    );
  }
  // Everything offered to the sign-up tool is offered to somebody else's error messages too: a
  // target that quotes its arguments back in a validation error quotes the password.
  secrets.add(suggested.password);
  const result = await session.call(signupTool, { email: suggested.email, displayName: suggested.displayName, password: suggested.password });
  if (result.result.isError) throw new ProvisionFailed(`${signupTool} failed: ${result.result.text}`, null);
  // From here the account EXISTS. Every failure below carries it, so that the result can name it
  // rather than claim nothing was left behind.
  if (!provider.capture) throw new ProvisionFailed(`the ${signupTool} tool answered, but this identity strategy cannot read a credential out of a tool result`, suggested.email);
  const captured = provider.capture({ tool: signupTool, arguments: { email: suggested.email, displayName: suggested.displayName }, result: result.data });
  if (!captured) {
    throw new ProvisionFailed(`${signupTool} answered, but no token was found where the identity settings say it comes back; check the token path against the result it returned`, suggested.email);
  }
  return { ...captured, email: captured.email ?? suggested.email, displayName: captured.displayName ?? suggested.displayName };
}

/**
 * Takes the account back down, or says plainly that it is still there.
 *
 * Silence is the one unacceptable outcome. A provider that declares `ownsAccounts: false` was
 * handed an account somebody else made, and one that declares `cannotRemove` made it and has no
 * way to delete it — in both cases an account is left on somebody's product, and in both cases the
 * result names it. A teardown that throws is the same story with a different reason.
 *
 * The teardown tool is deliberately EXEMPT from the target's tool policy, unlike the sign-up tool
 * and the read-only call. The policy governs what the people populace sends may touch; teardown is
 * populace's own housekeeping and is never offered to a model. Refusing to call it because a
 * denylist mentions it would leave an account on somebody's product to honour a rule about what
 * agents may do — strictly worse, in the one direction this whole module exists to avoid. It is
 * the same exemption a sweep runs under.
 */
async function tearDown(
  provider: IdentityProvider,
  identity: Identity,
  endpoint: StoredTarget["mcp"][number],
  handle: string,
): Promise<Pick<FirstContact, "tornDown" | "leftBehind">> {
  if (provider.ownsAccounts === false) {
    return { tornDown: false, leftBehind: { handle, why: "this account existed before populace — it came from the accounts file — so it was used and left exactly as it was" } };
  }
  // Asked before `cannotRemove` is read, for the same reason a sweep asks: a provider that learns
  // what the target can do from the target's own handshake reports `undefined` — "it can remove
  // them" — until it has asked. An app that soft-deletes would otherwise have the removal
  // attempted, refused, and reported as a failure of populace's rather than as an account left
  // on the product with its reason named.
  if (provider.describe) {
    try {
      await provider.describe();
    } catch {
      /* the endpoint could not be asked; the teardown below tries anyway and reports its own failure */
    }
  }
  const cannotRemove = provider.cannotRemove;
  if (cannotRemove !== undefined) return { tornDown: false, leftBehind: { handle, why: cannotRemove } };

  const deps: TeardownDeps = {
    callTool: async (bearerToken: string | undefined, tool: string, args: JsonValue) => {
      const session = new McpSession(endpoint, bearerToken);
      try {
        await session.connect();
        const outcome = await session.call(tool, typeof args === "object" && args !== null && !Array.isArray(args) ? args : {});
        return { isError: outcome.result.isError, text: outcome.result.text };
      } finally {
        await session.close();
      }
    },
    // The probe identity is never persisted — a check must not leave rows behind any more than it
    // leaves accounts behind — so there is nothing stored to list.
    listStoredIdentities: () => Promise.resolve([]),
  };
  try {
    await provider.teardown(identity, deps);
    return { tornDown: true, leftBehind: null };
  } catch (err) {
    return { tornDown: false, leftBehind: { handle, why: `populace could not remove it: ${(err instanceof Error ? err.message : String(err))}` } };
  }
}
