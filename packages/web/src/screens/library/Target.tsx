import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, type FirstContact, type StoredTarget, type TargetCheck } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import type { TargetInput } from "@populace/contract";
import { blockedBecause, effectiveToolPolicy, type ToolPolicy } from "@populace/core/isomorphic";
import { Breadcrumb, Button, Card, Chip, Failed, Field, Input, Loading, Mono, Payload, Problem, Saved, Section, Select, TextArea, ToolName } from "../../components/ui.jsx";
import { ms } from "../../format.js";

interface EndpointDraft {
  name: string;
  url: string;
  /** Empty means "leave whatever is stored alone"; the screen never sees a saved token. */
  bearerToken: string;
  authenticated: boolean;
}

interface Draft {
  name: string;
  mcp: EndpointDraft[];
  webBaseUrl: string;
  description: string;
  signupTool: string;
  tokenPath: string;
  userIdPath: string;
  teardownTool: string;
  emailDomain: string;
  strategy: "self-signup" | "static" | "admin-mint";
  staticFile: string;
  /** admin-mint: the Firebase Web API key. Empty means "leave whatever is stored alone". */
  apiKey: string;
  apiKeySet: boolean;
  serviceAccountFile: string;
  firebaseProjectId: string;
  exchangeUrl: string;
  /** What ANYBODY sent here may touch. A persona can narrow this; nothing can widen it. */
  tools: ToolPolicy;
}

const EMPTY: Draft = {
  name: "",
  mcp: [{ name: "default", url: "", bearerToken: "", authenticated: false }],
  webBaseUrl: "",
  description: "",
  signupTool: "",
  tokenPath: "token",
  userIdPath: "",
  teardownTool: "",
  emailDomain: "populace.test",
  strategy: "self-signup",
  staticFile: "",
  apiKey: "",
  apiKeySet: false,
  serviceAccountFile: "",
  firebaseProjectId: "",
  exchangeUrl: "",
  tools: { allow: [], deny: [], destructive: "confirm" },
};

function draftFrom(target: StoredTarget): Draft {
  const identity = target.identity;
  return {
    name: target.name,
    mcp: target.mcp.map((e) => ({ name: e.name, url: e.url, bearerToken: "", authenticated: e.authenticated })),
    webBaseUrl: target.webBaseUrl ?? "",
    description: target.description ?? "",
    signupTool: identity.strategy === "self-signup" ? identity.signupTool : "",
    tokenPath: identity.strategy === "self-signup" ? identity.tokenPath : "token",
    userIdPath: identity.strategy === "self-signup" ? (identity.userIdPath ?? "") : "",
    teardownTool: identity.strategy === "self-signup" ? (identity.teardownTool ?? "") : "",
    emailDomain: identity.strategy === "self-signup" ? identity.emailDomain : "populace.test",
    strategy: identity.strategy,
    staticFile: identity.strategy === "static" ? identity.file : "",
    // Never pre-filled: the stored key is not sent to the browser, so blank means "keep it".
    apiKey: "",
    apiKeySet: identity.strategy === "admin-mint" ? identity.apiKeySet : false,
    serviceAccountFile: identity.strategy === "admin-mint" ? (identity.serviceAccountFile ?? "") : "",
    firebaseProjectId: identity.strategy === "admin-mint" ? (identity.projectId ?? "") : "",
    exchangeUrl: identity.strategy === "admin-mint" ? (identity.exchangeUrl ?? "") : "",
    tools: target.tools,
  };
}

/**
 * A `switch`, not an if/else chain: the chain's final `else` silently produced an admin-mint
 * config for any strategy it did not know about, so a fourth way in would have compiled and
 * quietly sent the wrong one.
 */
function identityFrom(draft: Draft): TargetInput["identity"] {
  switch (draft.strategy) {
    case "self-signup":
      return {
        strategy: "self-signup",
        signupTool: draft.signupTool,
        tokenPath: draft.tokenPath || "token",
        ...(draft.userIdPath ? { userIdPath: draft.userIdPath } : {}),
        ...(draft.teardownTool ? { teardownTool: draft.teardownTool } : {}),
        emailDomain: draft.emailDomain || "populace.test",
      };
    case "static":
      return { strategy: "static", file: draft.staticFile };
    case "admin-mint":
      return {
        strategy: "admin-mint",
        provider: "firebase",
        emailDomain: draft.emailDomain || "populace.test",
        // Absent leaves the stored key alone; the form only sends one when it was typed.
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(draft.serviceAccountFile ? { serviceAccountFile: draft.serviceAccountFile } : {}),
        ...(draft.firebaseProjectId ? { projectId: draft.firebaseProjectId } : {}),
        ...(draft.exchangeUrl ? { exchangeUrl: draft.exchangeUrl } : {}),
      };
  }
}

function bodyFrom(draft: Draft): TargetInput {
  const identity: TargetInput["identity"] = identityFrom(draft);
  return {
    name: draft.name,
    mcp: draft.mcp.map((e) => ({ name: e.name, url: e.url, ...(e.bearerToken === "" ? {} : { bearerToken: e.bearerToken }) })),
    ...(draft.webBaseUrl ? { webBaseUrl: draft.webBaseUrl } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    identity,
    tools: draft.tools,
  };
}

/**
 * One target. The form is one thing and the live connection panel under it is another:
 * the panel is what the target says about itself right now, and it is what the identity fields
 * are filled in from — the screen says so rather than filling them in silently, because choosing
 * the wrong sign-up tool means every person in the run fails to get through the front door.
 */
export function Target() {
  const { key: projectKey, project, href } = useProject();
  const { t = "new" } = useParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const targets = useQuery(q.targets(projectKey));
  const existing = t === "new" ? undefined : targets.data?.items.find((target) => target.id === t);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [check, setCheck] = useState<TargetCheck | null>(null);
  const [contact, setContact] = useState<FirstContact | null>(null);

  useEffect(() => {
    if (loaded || !targets.isSuccess) return;
    setDraft(existing ? draftFrom(existing) : EMPTY);
    setLoaded(true);
  }, [loaded, targets.isSuccess, existing]);

  const usedBy = project.simulations.filter((simulation) => simulation.target.id === existing?.id);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }));
  const setEndpoint = (index: number, patch: Partial<EndpointDraft>): void =>
    setDraft((d) => ({ ...d, mcp: d.mcp.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));

  const save = useMutation({
    mutationFn: () => api.saveTarget(projectKey, existing?.id ?? null, bodyFrom(draft)),
    onSuccess: async (saved) => {
      setDraft(draftFrom(saved));
      await queries.invalidateQueries();
      // A target that has just been created has an id now, and the URL should say which one it is.
      if (existing === undefined) void navigate(href(`library/target/${encodeURIComponent(saved.id)}`), { replace: true });
    },
  });

  /**
   * Checks what is typed, saved or not, so the wizard can show the tool list before committing
   * anything. A saved target is checked by id so a stored token is used without ever being sent
   * back to the browser to send up again.
   */
  const connect = useMutation({
    mutationFn: () =>
      existing && !save.isPending
        ? api.checkTarget(projectKey, existing.id)
        : api.checkDraftTarget(projectKey, { mcp: draft.mcp.map((e) => ({ name: e.name, url: e.url, ...(e.bearerToken === "" ? {} : { bearerToken: e.bearerToken }) })) }),
    onSuccess: (result) => {
      setCheck(result);
      // Pre-fill only what is still empty. A value already in the form is the user's answer.
      setDraft((d) => ({
        ...d,
        signupTool: d.signupTool || (result.identity.signupTool ?? ""),
        tokenPath: d.tokenPath || (result.identity.tokenPath ?? "token"),
        userIdPath: d.userIdPath || (result.identity.userIdPath ?? ""),
        teardownTool: d.teardownTool || (result.identity.teardownTool ?? ""),
      }));
    },
  });

  /**
   * One person through the front door, for real: an account is provisioned the way the settings
   * above say, one read-only tool is called with it, and the account is taken back down. It calls
   * no model, so it costs nothing — which is the point of being able to run it before a run.
   */
  const firstContact = useMutation({
    mutationFn: () => api.firstContact(projectKey, existing?.id ?? ""),
    onSuccess: async (result) => {
      setContact(result);
      await queries.invalidateQueries();
    },
  });

  const promises = useQuery({ ...q.promises(projectKey, existing?.id ?? ""), enabled: existing !== undefined && draft.webBaseUrl !== "" });

  if (targets.isPending) return <Loading what="your target" />;
  if (targets.isError) return <Failed error={targets.error} />;

  const unkept = promises.data?.promises.filter((p) => !p.kept) ?? [];

  return (
    <div>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <Breadcrumb items={[{ label: "The target", to: href("library/target") }, { label: existing?.name ?? "New target" }]} />
          <h1 className="t-title mt-1">{existing?.name ?? "Connect a target"}</h1>
          <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
            Where the people go. Everything below is what they are told before their first visit, and what they are allowed to reach when they get there.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Saved at={existing?.updatedAt ?? null} />
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending || draft.name === "" || draft.mcp[0]?.url === ""}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {existing && usedBy.length > 0 ? (
        <p className="t-meta text-ink-muted mb-4">
          Used by {usedBy.map((simulation) => simulation.name).join(", ")}. Changing the address here changes where {usedBy.length === 1 ? "it sends" : "they send"} people.
        </p>
      ) : null}

      <Section title="What it is">
        <Card className="p-4">
          <Field label="Name">
            <Input value={draft.name} onChange={(v) => set("name", v)} placeholder="Tasklet" />
          </Field>
          {draft.mcp.map((endpoint, index) => (
            <div key={index} className="mb-4">
              <Field label={index === 0 ? "MCP address" : `MCP address (${endpoint.name})`}>
                <Input value={endpoint.url} onChange={(v) => setEndpoint(index, { url: v })} placeholder="http://127.0.0.1:4310/mcp" mono />
              </Field>
              <Field label="Bearer token" hint={endpoint.authenticated ? "One is already stored. Leave this blank to keep it, or type a new one to replace it." : "Only for a gateway that needs a static token. Each person's own account token takes precedence."}>
                <Input value={endpoint.bearerToken} onChange={(v) => setEndpoint(index, { bearerToken: v })} placeholder={endpoint.authenticated ? "•••••••• stored" : "none"} type="password" mono />
              </Field>
            </div>
          ))}
          <Button onClick={() => setDraft((d) => ({ ...d, mcp: [...d.mcp, { name: `endpoint-${d.mcp.length + 1}`, url: "", bearerToken: "", authenticated: false }] }))}>+ Add another endpoint</Button>

          <div className="mt-5">
            <Field label="Web address" hint="Optional. Lets the people read the product's own pages, and lets us compare what it promises against what it exposes.">
              <Input value={draft.webBaseUrl} onChange={(v) => set("webBaseUrl", v)} placeholder="http://127.0.0.1:4310" mono />
            </Field>
            <Field label="What it says it does" hint="Handed to every person before their first visit, the way marketing copy would be.">
              <TextArea value={draft.description} onChange={(v) => set("description", v)} rows={3} placeholder="Tasklet keeps your projects and tasks in one place…" />
            </Field>
          </div>
        </Card>
      </Section>

      <Section title="How they get an account" sub="found by matching the tool list">
        <Card className="p-4">
          <Field label="Way in">
            <Select
              value={draft.strategy}
              onChange={(v) => set("strategy", v as Draft["strategy"])}
              options={[
                { value: "self-signup", label: "They sign themselves up (recommended)" },
                { value: "static", label: "Accounts from a file I provide" },
                { value: "admin-mint", label: "Minted by an admin SDK" },
              ]}
            />
          </Field>
          {draft.strategy === "self-signup" ? (
            <>
              <Field label="Sign-up tool" hint="The tool that creates an account.">
                <Input value={draft.signupTool} onChange={(v) => set("signupTool", v)} placeholder="sign_up" mono />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Where the token comes back" hint="Dotted path into the result.">
                  <Input value={draft.tokenPath} onChange={(v) => set("tokenPath", v)} placeholder="token" mono />
                </Field>
                <Field label="Where the account id comes back" hint="Optional.">
                  <Input value={draft.userIdPath} onChange={(v) => set("userIdPath", v)} placeholder="user.id" mono />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tool that deletes an account" hint="Used to clean up afterwards. Without it, accounts have to be removed by hand.">
                  <Input value={draft.teardownTool} onChange={(v) => set("teardownTool", v)} placeholder="delete_account" mono />
                </Field>
                <Field label="Email domain" hint="Every address carries the run's tag, so sweep can find them again.">
                  <Input value={draft.emailDomain} onChange={(v) => set("emailDomain", v)} mono />
                </Field>
              </div>
            </>
          ) : draft.strategy === "static" ? (
            <Field label="Accounts file" hint={'JSON keyed by cohort — { "byCohort": { "<cohort slug>": [ { "bearerToken": "..." } ] } } — with one entry per person. These accounts are yours: a clean-up leaves them alone.'}>
              <Input value={draft.staticFile} onChange={(v) => set("staticFile", v)} placeholder="accounts.json" mono />
            </Field>
          ) : (
            <>
              <p className="t-body text-ink-soft mb-3 max-w-[68ch]">
                The service account creates each person in Firebase; the Web API key turns what comes back into a session the product will accept. Both are needed — a Firebase custom token is
                not an ID token, and anything that verifies one will refuse it.
              </p>
              <Field label="Web API key" hint={draft.apiKeySet ? "One is already stored. Leave this blank to keep it, or type a new one to replace it." : "Firebase console → Project settings → General → Web API Key. Used to exchange the custom token and to renew it every hour."}>
                <Input value={draft.apiKey} onChange={(v) => set("apiKey", v)} placeholder={draft.apiKeySet ? "•••••••• stored" : "AIza…"} type="password" mono />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Service account file" hint="Path to the JSON key. Leave empty to use GOOGLE_APPLICATION_CREDENTIALS.">
                  <Input value={draft.serviceAccountFile} onChange={(v) => set("serviceAccountFile", v)} placeholder="./service-account.json" mono />
                </Field>
                <Field label="Firebase project" hint="Optional. Only needed when the credentials do not name one.">
                  <Input value={draft.firebaseProjectId} onChange={(v) => set("firebaseProjectId", v)} placeholder="my-app-staging" mono />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email domain" hint="Every address carries the run's tag, so sweep can find them again.">
                  <Input value={draft.emailDomain} onChange={(v) => set("emailDomain", v)} mono />
                </Field>
                <Field label="Exchange endpoint" hint="Optional. An endpoint of your own that turns a custom token into the bearer your product accepts. Set one and it replaces Google's exchange entirely — sessions are renewed through it too, never through Google.">
                  <Input value={draft.exchangeUrl} onChange={(v) => set("exchangeUrl", v)} placeholder="https://…" mono />
                </Field>
              </div>
            </>
          )}
          <FirstContactPanel
            saved={existing !== undefined}
            result={contact ?? existing?.firstContact ?? null}
            running={firstContact.isPending}
            error={firstContact.error}
            onRun={() => firstContact.mutate()}
          />
          {check?.identity.because.length ? (
            <ul className="mt-2 border-t border-rule pt-3">
              {check.identity.because.map((line, i) => (
                <li key={i} className="t-meta text-ink-muted">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </Section>

      <Section title="What it answers" sub="live, right now">
        <Card className="p-4">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            {check === null ? (
              <span className="t-body text-ink-muted">Not checked yet.</span>
            ) : check.ok ? (
              <>
                <Chip tone="good">connected</Chip>
                {check.latencyMs === null ? null : <span className="t-meta text-ink-muted">{ms(check.latencyMs)}</span>}
                {check.server ? (
                  <Mono className="text-[11.5px] text-ink-muted">
                    {check.server.name} {check.server.version}
                  </Mono>
                ) : null}
                <span className="t-meta text-ink-muted">{check.tools.length} tools</span>
              </>
            ) : (
              <Chip tone="bad">could not connect</Chip>
            )}
            <span className="flex-1" />
            <Button onClick={() => connect.mutate()} disabled={connect.isPending || draft.mcp[0]?.url === ""}>
              {connect.isPending ? "Checking…" : "Check again"}
            </Button>
          </div>

          {check?.errors.map((error, i) => (
            <Problem key={i}>{error}</Problem>
          ))}

          {check?.undescribed.length ? (
            <div className="mb-4 border border-medium/30 rounded-md p-3">
              <p className="t-body text-ink">
                {check.undescribed.length === 1 ? "One tool has no description" : `${check.undescribed.length} tools have no description`}.
              </p>
              <p className="t-body text-ink-soft mt-1">People decide what to try from descriptions alone, so an undescribed tool will most likely never be touched.</p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {check.undescribed.map((name) => (
                  <ToolName key={name} name={name} />
                ))}
              </p>
            </div>
          ) : null}

          {check?.tools.length ? (
            <ul className="divide-y divide-rule border-t border-rule">
              {check.tools.map((tool) => (
                <li key={`${tool.endpoint}/${tool.name}`} className="py-2 flex items-baseline gap-3">
                  <ToolName name={tool.name} />
                  <span className="t-body text-ink-soft flex-1">{tool.description || <span className="text-ink-muted italic">no description</span>}</span>
                  {tool.destructive ? <Chip tone="bad">destructive</Chip> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </Section>

      <Section title="What anyone sent here may touch" sub="the floor; a persona can narrow it, nothing can widen it">
        <ToolPolicyEditor policy={draft.tools} onChange={(tools) => set("tools", tools)} tools={check?.tools ?? null} />
      </Section>

      {draft.webBaseUrl && existing ? (
        <Section title="What the website promises" sub="its own copy against the tools it exposes">
          <Card className="p-4">
            {promises.isPending ? (
              <Loading what="the product's pages" />
            ) : promises.isError || promises.data?.error !== null ? (
              <p className="t-body text-ink-muted">{promises.data?.error ?? "Could not read the website."}</p>
            ) : unkept.length === 0 ? (
              <p className="t-body text-ink-soft">Every promise we could read has a tool behind it.</p>
            ) : (
              <>
                <p className="t-body text-ink-soft mb-3">
                  {unkept.length === 1 ? "One thing the website says" : `${unkept.length} things the website says`} had no tool we could match. This is a coverage gap found before anyone visits, so it is a guess, not a verdict.
                </p>
                <ul className="divide-y divide-rule border-t border-rule">
                  {unkept.map((promise, i) => (
                    <li key={i} className="py-2 t-body text-ink">
                      “{promise.text}”
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Globs are only as good as what they match, so the effect is shown rather than described: every
 * tool the target actually exposes, marked allowed or blocked under what is typed right now.
 *
 * This is the screen where somebody decides what a whole population may touch, and it is the right
 * altitude for the decision — a tool that is dangerous is dangerous whichever persona reaches for
 * it. A persona's own policy is merged onto this one, and the merge can only ever narrow it.
 */
function ToolPolicyEditor({
  policy,
  onChange,
  tools,
}: {
  policy: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  tools: TargetCheck["tools"] | null;
}) {
  const asList = (value: string): string[] =>
    value
      .split(/[,\n]/)
      .map((pattern) => pattern.trim())
      .filter(Boolean);
  const effective = effectiveToolPolicy(policy);
  const blocked = (tools ?? []).filter((tool) => blockedBecause(tool.name, effective) !== null);

  return (
    <Card className="p-4">
      <p className="t-body text-ink-soft mb-4 max-w-[68ch]">
        Everyone who comes here obeys this, whoever they are pretending to be. A persona can take more away; it can never put anything back.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Allow" hint="Empty means everything the target exposes.">
          <Input value={policy.allow.join(", ")} onChange={(v) => onChange({ ...policy, allow: asList(v) })} placeholder="get_*, list_*" mono />
        </Field>
        <Field label="Deny" hint="Always wins over allow, on every persona.">
          <Input value={policy.deny.join(", ")} onChange={(v) => onChange({ ...policy, deny: asList(v) })} placeholder="delete_*, updateOrg*" mono />
        </Field>
      </div>
      <Field label="Tools the target marks destructive" hint="A persona may be stricter than this, never looser.">
        <Select
          value={policy.destructive}
          onChange={(v) => onChange({ ...policy, destructive: v as ToolPolicy["destructive"] })}
          options={[
            { value: "confirm", label: "Ask them to confirm first (recommended)" },
            { value: "allow", label: "Let them do it" },
            { value: "deny", label: "Never" },
          ]}
        />
      </Field>

      <div className="border-t border-rule pt-3">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="t-label text-ink-muted">What that leaves them</span>
          {tools === null ? null : (
            <span className="t-meta text-ink-muted">
              {tools.length - blocked.length} of {tools.length} tools reachable
            </span>
          )}
        </div>
        {tools === null ? (
          <p className="t-body text-ink-muted italic">Check the connection above and every tool the target exposes is listed here, marked allowed or blocked.</p>
        ) : (
          <ul className="divide-y divide-rule border-t border-rule">
            {tools.map((tool) => {
              const why = blockedBecause(tool.name, effective);
              return (
                <li key={`${tool.endpoint}/${tool.name}`} className="py-2 flex items-baseline gap-3">
                  <span className={why === null ? "" : "line-through opacity-50"}>
                    <ToolName name={tool.name} />
                  </span>
                  <span className="t-body text-ink-soft flex-1 truncate">{tool.description}</span>
                  {tool.destructive ? <Chip tone="bad">destructive</Chip> : null}
                  {why === null ? <Chip tone="good">allowed</Chip> : <Chip tone="bad">blocked · {why}</Chip>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * "Does any of this actually work?" — the one thing the forms above cannot tell you.
 *
 * It makes ONE account the configured way, calls ONE read-only tool with it and removes the
 * account again, and then says which of the four things happened: the endpoint never answered, the
 * account could not be made, the account was made and the target refused its token, or it all
 * worked. No model is called, so it costs nothing however it ends.
 */
function FirstContactPanel({
  saved,
  result,
  running,
  error,
  onRun,
}: {
  saved: boolean;
  result: FirstContact | null;
  running: boolean;
  error: Error | null;
  onRun: () => void;
}) {
  const tone = result === null ? "neutral" : result.outcome === "accepted" ? "good" : result.outcome === "connected-only" || result.outcome === "tool-failed" ? "neutral" : "bad";
  const label: Record<FirstContact["outcome"], string> = {
    accepted: "they can get in",
    "connected-only": "connected, nothing called",
    "tool-failed": "got in; the tool failed",
    rejected: "the target refused the account",
    "provision-failed": "no account could be made",
    unreachable: "could not reach it",
  };

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <span className="t-label text-ink-muted">First contact</span>
        {result === null ? null : <Chip tone={tone}>{label[result.outcome]}</Chip>}
        <span className="flex-1" />
        <Button onClick={onRun} disabled={!saved || running}>
          {running ? "Trying it…" : result === null ? "Try it for real" : "Try it again"}
        </Button>
      </div>
      <p className="t-body text-ink-soft max-w-[68ch]">
        Makes one account the way you have set it up, calls one read-only tool with it, and removes the account again. It calls no model, so it costs nothing —
        {saved ? " and it is the only way to find out before a run does." : " save the target first."}
      </p>
      {error ? <Problem>{error.message}</Problem> : null}
      {result === null ? null : (
        <div className="mt-3 border border-rule rounded-md p-3">
          <p className="t-body text-ink">{result.summary}</p>
          {result.detail ? (
            <div className="mt-2">
              <Payload>{result.detail}</Payload>
            </div>
          ) : null}
          <p className="t-meta text-ink-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {result.handle ? <span>account {result.handle}</span> : null}
            {result.tool ? (
              <span>
                answered by <ToolName name={result.tool} />
              </span>
            ) : null}
            {result.latencyMs === null ? null : <span>{ms(result.latencyMs)}</span>}
            <span>{result.tornDown ? "the account was removed again" : "nothing was removed"}</span>
          </p>
          {result.leftBehind ? (
            <p className="t-body text-medium mt-2">
              An account was left on the target: {result.leftBehind.handle}. {result.leftBehind.why}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
