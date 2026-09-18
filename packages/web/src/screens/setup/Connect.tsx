import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type StoredTarget, type TargetCheck } from "../../api.js";
import type { TargetInput } from "@populace/contract";
import { Button, Card, Chip, Failed, Field, Input, Loading, Mono, Problem, Saved, Section, Select, TextArea, ToolName } from "../../components/ui.jsx";
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
  };
}

function bodyFrom(draft: Draft): TargetInput {
  const identity: TargetInput["identity"] =
    draft.strategy === "self-signup"
      ? {
          strategy: "self-signup",
          signupTool: draft.signupTool,
          tokenPath: draft.tokenPath || "token",
          ...(draft.userIdPath ? { userIdPath: draft.userIdPath } : {}),
          ...(draft.teardownTool ? { teardownTool: draft.teardownTool } : {}),
          emailDomain: draft.emailDomain || "populace.test",
        }
      : draft.strategy === "static"
        ? { strategy: "static", file: draft.staticFile }
        : { strategy: "admin-mint", provider: "firebase", emailDomain: draft.emailDomain || "populace.test" };
  return {
    name: draft.name,
    mcp: draft.mcp.map((e) => ({ name: e.name, url: e.url, ...(e.bearerToken === "" ? {} : { bearerToken: e.bearerToken }) })),
    ...(draft.webBaseUrl ? { webBaseUrl: draft.webBaseUrl } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    identity,
  };
}

/**
 * Connecting a target. The form is one thing and the live connection panel under it is another:
 * the panel is what the target says about itself right now, and it is what the identity fields
 * are filled in from — the screen says so rather than filling them in silently, because choosing
 * the wrong sign-up tool means every person in the run fails to get through the front door.
 */
export function Connect() {
  const queries = useQueryClient();
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const existing = targets.data?.items[0];

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [check, setCheck] = useState<TargetCheck | null>(null);

  useEffect(() => {
    if (loaded || !targets.isSuccess) return;
    setDraft(existing ? draftFrom(existing) : EMPTY);
    setLoaded(true);
  }, [loaded, targets.isSuccess, existing]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }));
  const setEndpoint = (index: number, patch: Partial<EndpointDraft>): void =>
    setDraft((d) => ({ ...d, mcp: d.mcp.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));

  const save = useMutation({
    mutationFn: () => api.saveTarget(existing?.id ?? null, bodyFrom(draft)),
    onSuccess: async (saved) => {
      setDraft(draftFrom(saved));
      await queries.invalidateQueries();
    },
  });

  /**
   * Checks what is typed, saved or not, so the wizard can show the tool list before committing
   * anything. A saved target is checked by id so a stored token is used without ever being sent
   * back to the browser to send up again.
   */
  const connect = useMutation({
    mutationFn: () => (existing && !save.isPending ? api.checkTarget(existing.id) : api.checkDraftTarget({ mcp: draft.mcp.map((e) => ({ name: e.name, url: e.url, ...(e.bearerToken === "" ? {} : { bearerToken: e.bearerToken }) })) })),
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

  const promises = useQuery({ queryKey: ["promises", existing?.id], queryFn: () => api.promises(existing?.id ?? ""), enabled: existing !== undefined && draft.webBaseUrl !== "" });

  if (targets.isPending) return <Loading what="your target" />;
  if (targets.isError) return <Failed error={targets.error} />;

  const unkept = promises.data?.promises.filter((p) => !p.kept) ?? [];

  return (
    <div>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <h1 className="t-title">The target</h1>
          <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
            Where the people go. Everything below is what they are told before their first visit, and what they are allowed to reach when they get there.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Saved at={existing?.updatedAt ?? null} />
          {/* The design puts "Export as YAML" here; the file is the whole config rather than the
              target alone, so this is a way in to the screen that holds it. */}
          <Link to="/setup/config" className="t-body px-3 py-1.5 rounded-md border bg-card text-ink-soft border-rule hover:bg-well">
            Export as YAML
          </Link>
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending || draft.name === "" || draft.mcp[0]?.url === ""}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}

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
            <Field label="Accounts file" hint="JSON, keyed by person id, holding the tokens to use.">
              <Input value={draft.staticFile} onChange={(v) => set("staticFile", v)} placeholder="accounts.json" mono />
            </Field>
          ) : (
            <Field label="Email domain">
              <Input value={draft.emailDomain} onChange={(v) => set("emailDomain", v)} mono />
            </Field>
          )}
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
