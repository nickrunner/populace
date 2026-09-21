import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, type FirstContact, type StoredTarget, type TargetCheck } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import type { TargetInput } from "@populace/contract";
import type { ToolPolicy } from "@populace/core/isomorphic";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConditionalFieldset,
  ConnectionStatusBar,
  Field,
  FieldGrid,
  FirstContactPanel,
  FormPage,
  Input,
  Ledger,
  LedgerRow,
  Measure,
  Mono,
  PageHeader,
  Repeater,
  Section,
  SecretField,
  Skeleton,
  Stack,
  StateBlock,
  Tabs,
  Text,
  TextArea,
  ToolName,
  ToolPolicyEditor,
  WhatWentWrong,
  type ConditionalBranch,
  type StateKind,
} from "../../design/index.js";

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
 * What the form holds against what was last saved. `updatedAt` and the endpoints' `authenticated`
 * flags are read-only, and they ride along inside the draft, so the comparison is against a draft
 * rebuilt from the same record rather than against the record itself.
 */
const shapeOf = (draft: Draft): string => JSON.stringify(draft);

/** The four panels, in the order a target is set up. */
const TABS = [
  { value: "what-it-is", label: "What it is" },
  { value: "getting-in", label: "How they get an account" },
  { value: "answers", label: "What it answers" },
  { value: "policy", label: "What they may touch" },
] as const;

/**
 * One target. The form is one thing and the live connection panel is another: the panel is what
 * the target says about itself right now, and it is what the identity fields are filled in from —
 * the screen says so rather than filling them in silently, because choosing the wrong sign-up tool
 * means every person in the execution fails to get through the front door.
 *
 * Ported to the design system — ATOMIC-INVENTORY §6.3 row 22, the largest screen in the app.
 * `FormPage` owns the reading column, the sticky bar and the unsaved-changes guard; `Tabs` owns
 * the four subjects that were four stacked sections in one 599-line scroll. What went with them:
 * four `max-w-[68ch]`, three `divide-y divide-rule` lists, **four separate renderings of
 * connection state** (now `ConnectionStatusBar`), the hand-rolled password-plus-hint pair (now
 * `SecretField`), the nested ternary over three identity strategies (now `ConditionalFieldset`),
 * the duplicated `asList()` (now `TagListField`, inside `ToolPolicyEditor`) — and the endpoint
 * repeater **with no remove button**, which is a real bug and is now `Repeater`'s rule.
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
  const [tab, setTab] = useState<string>(TABS[0].value);
  /** A save has been asked for at least once, which is when the blockers become messages. */
  const [attempted, setAttempted] = useState(false);

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

  const unkept = promises.data?.promises.filter((p) => !p.kept) ?? [];

  const firstUrl = draft.mcp[0]?.url ?? "";
  /** What the server would refuse, named here so the reader is not told by a dead button (§6). */
  const missingName = draft.name === "";
  const missingAddress = firstUrl === "";
  const dirty =
    loaded && shapeOf(draft) !== shapeOf(existing === undefined ? EMPTY : draftFrom(existing));

  /**
   * The state goes to the template's slot rather than returning early, so the header and the
   * reading column stay mounted while the body is a sentence. `gone` is only reachable while no
   * save is in flight or done: a target created a moment ago has an id the list has not printed
   * yet, and that is a new record, not a missing one.
   */
  const state: StateKind | undefined = targets.isPending
    ? "loading"
    : targets.isError
      ? "failed"
      : t !== "new" && existing === undefined && save.isIdle
        ? "gone"
        : undefined;

  const what = "this target";

  return (
    <FormPage
      header={
        <PageHeader
          title={existing?.name ?? "Connect a target"}
          crumbs={[{ label: "The target", to: href("library/target") }, { label: existing?.name ?? "New target" }]}
          lede="Where the people go. Everything here is what they are told before their first visit, and what they are allowed to reach when they get there."
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what={what}
          skeleton={<Skeleton variant="block" height={148} count={3} label={`Reading ${what}`} />}
        />
      }
      error={
        <StateBlock kind="failed" what={what} error={targets.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void targets.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      gone={
        <StateBlock kind="gone" what={what}>
          This project has no target with that address any more. The ones it does have are on{" "}
          the targets page, and a new one can be connected from there.
        </StateBlock>
      }
      dirty={dirty}
      saving={save.isPending}
      savedAt={existing?.updatedAt ?? null}
      onSave={() => {
        setAttempted(true);
        // The blockers live on the first panel, so the reader is taken to the field that is
        // refusing rather than left pressing a bar that does nothing.
        if (missingName || missingAddress) {
          setTab(TABS[0].value);
          return;
        }
        save.mutate();
      }}
    >
      <Stack gap={8}>
        {save.isError ? (
          <WhatWentWrong
            says="Saving failed. Nothing here was written, and what is on this page is still yours to send again."
            error={save.error}
          />
        ) : null}

        {existing && usedBy.length > 0 ? (
          <Measure width="read">
            <Text as="p" size="meta" tone="muted">
              Used by {usedBy.map((simulation) => simulation.name).join(", ")}. Changing the
              address here changes where {usedBy.length === 1 ? "it sends" : "they send"} people.
            </Text>
          </Measure>
        ) : null}

        <Tabs value={tab} onChange={setTab} tabs={TABS}>
          {tab === "what-it-is" ? (
            <Stack gap={8}>
              <Card>
                <Stack gap={6}>
                  <Field
                    label="Name"
                    error={attempted && missingName ? "A target needs a name." : undefined}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.name}
                        onChange={(v) => set("name", v)}
                        placeholder="The task manager, staging"
                      />
                    )}
                  </Field>

                  <Repeater
                    legend="MCP addresses"
                    addLabel="Add another address"
                    minReason="A target is at least one MCP address, so this one stays."
                    onAdd={() => {
                      setDraft((d) => ({
                        ...d,
                        mcp: [...d.mcp, { name: `endpoint-${d.mcp.length + 1}`, url: "", bearerToken: "", authenticated: false }],
                      }));
                    }}
                    onRemove={(index) => {
                      setDraft((d) => ({ ...d, mcp: d.mcp.filter((_, i) => i !== index) }));
                    }}
                    items={draft.mcp.map((endpoint, index) => ({
                      id: `${String(index)}-${endpoint.name}`,
                      label: `The ${endpoint.name} address`,
                      fields: (
                        <Stack gap={4}>
                          <Field
                            label="Address"
                            error={
                              attempted && index === 0 && missingAddress
                                ? "Where the people go — the MCP endpoint this target answers on."
                                : undefined
                            }
                          >
                            {({ id, describedBy, invalid }) => (
                              <Input
                                id={id}
                                describedBy={describedBy}
                                invalid={invalid}
                                value={endpoint.url}
                                onChange={(v) => setEndpoint(index, { url: v })}
                                placeholder="http://127.0.0.1:4310/mcp"
                                mono
                              />
                            )}
                          </Field>
                          <SecretField
                            label="Bearer token"
                            stored={endpoint.authenticated}
                            value={endpoint.bearerToken}
                            onChange={(v) => setEndpoint(index, { bearerToken: v })}
                            hint="Only for a gateway that needs a static token. Each person's own account token takes precedence."
                          />
                        </Stack>
                      ),
                    }))}
                  />
                </Stack>
              </Card>

              <Card>
                <CardHeader title="What the people are told" level={2} />
                <Stack gap={6}>
                  <Field
                    label="Web address"
                    optional
                    hint="Lets the people read the product's own pages, and lets us compare what it promises against what it exposes."
                  >
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.webBaseUrl}
                        onChange={(v) => set("webBaseUrl", v)}
                        placeholder="http://127.0.0.1:4310"
                        mono
                      />
                    )}
                  </Field>
                  <Field
                    label="What it says it does"
                    hint="Handed to every person before their first visit, the way marketing copy would be."
                  >
                    {({ id, describedBy, invalid }) => (
                      <TextArea
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.description}
                        onChange={(v) => set("description", v)}
                        rows={3}
                        placeholder="Keeps everything your team is working on in one place, and says what is due next…"
                      />
                    )}
                  </Field>
                </Stack>
              </Card>
            </Stack>
          ) : null}

          {tab === "getting-in" ? (
            <Stack gap={8}>
              <Card>
                <Stack gap={8}>
                  <ConditionalFieldset
                    legend="Way in"
                    name="identity-strategy"
                    value={draft.strategy}
                    onChange={(strategy) => set("strategy", strategy)}
                    branches={WAYS_IN.map((way) => ({
                      ...way,
                      fields: identityFields(way.value, draft, set),
                    }))}
                  />

                  {check !== null && check.identity.because.length > 0 ? (
                    <Stack gap={2}>
                      <Text size="label" tone="muted">
                        Why these are filled in
                      </Text>
                      <Stack gap={1} as="ul">
                        {check.identity.because.map((line) => (
                          <li key={line}>
                            <Text size="meta" tone="muted">
                              {line}
                            </Text>
                          </li>
                        ))}
                      </Stack>
                    </Stack>
                  ) : null}
                </Stack>
              </Card>

              <Card>
                <FirstContactPanel
                  saved={existing !== undefined}
                  result={contact ?? existing?.firstContact ?? null}
                  running={firstContact.isPending}
                  error={firstContact.error}
                  onRun={() => firstContact.mutate()}
                />
              </Card>
            </Stack>
          ) : null}

          {tab === "answers" ? (
            <Stack gap={8}>
              <Card>
                <Stack gap={6}>
                  <ConnectionStatusBar
                    check={check}
                    checking={connect.isPending}
                    onCheck={() => connect.mutate()}
                    blocked={missingAddress ? "Type an MCP address first — there is nothing to ask yet." : undefined}
                    failure={connect.error}
                  />

                  {check !== null && check.undescribed.length > 0 ? (
                    <Card tone="sunk" pad="tight">
                      <Stack gap={2}>
                        <Text as="p" size="read">
                          {check.undescribed.length === 1
                            ? "One tool has no description"
                            : `${String(check.undescribed.length)} tools have no description`}
                          .
                        </Text>
                        <Measure width="read">
                          <Text as="p" size="read-sm" tone="soft">
                            People decide what to try from descriptions alone, so an undescribed
                            tool will most likely never be touched.
                          </Text>
                        </Measure>
                        <Stack gap={1} as="ul">
                          {check.undescribed.map((name) => (
                            <li key={name}>
                              <ToolName name={name} />
                            </li>
                          ))}
                        </Stack>
                      </Stack>
                    </Card>
                  ) : null}

                  {check !== null && check.tools.length > 0 ? (
                    <Ledger as="ol" stubLabel="Tool">
                      {check.tools.map((tool, index) => (
                        <LedgerRow
                          key={`${tool.endpoint}/${tool.name}`}
                          stub={
                            <Mono size="ref" tone="muted">
                              {index + 1}
                            </Mono>
                          }
                        >
                          <Stack gap={1}>
                            <ToolName name={tool.name} />
                            <Text size="meta" tone={tool.description === "" ? "muted" : "soft"}>
                              {tool.description === "" ? "no description" : tool.description}
                            </Text>
                            {tool.destructive ? (
                              <Badge tone="warn">destructive</Badge>
                            ) : null}
                          </Stack>
                        </LedgerRow>
                      ))}
                    </Ledger>
                  ) : null}
                </Stack>
              </Card>

              {draft.webBaseUrl && existing ? (
                <Section title="What the website promises" trailing={unkept.length === 0 ? undefined : `${String(unkept.length)} unmatched`}>
                  <Card>
                    {promises.isPending ? (
                      <StateBlock
                        kind="loading"
                        what="the product's pages"
                        skeleton={<Skeleton variant="line" count={3} label="Reading the product's pages" />}
                      />
                    ) : promises.isError || promises.data?.error !== null ? (
                      <Measure width="read">
                        <Text as="p" size="read-sm" tone="soft">
                          {promises.data?.error ?? "Could not read the website."}
                        </Text>
                      </Measure>
                    ) : unkept.length === 0 ? (
                      <Measure width="read">
                        <Text as="p" size="read-sm" tone="soft">
                          Every promise we could read has a tool behind it.
                        </Text>
                      </Measure>
                    ) : (
                      <Stack gap={4}>
                        <Measure width="read">
                          <Text as="p" size="read-sm" tone="soft">
                            {unkept.length === 1
                              ? "One thing the website says"
                              : `${String(unkept.length)} things the website says`}{" "}
                            had no tool we could match. This is a coverage gap found before
                            anyone visits, so it is a guess, not a verdict.
                          </Text>
                        </Measure>
                        <Ledger as="ol" stubLabel="Promise">
                          {unkept.map((promise, i) => (
                            <LedgerRow
                              key={promise.text}
                              stub={
                                <Mono size="ref" tone="muted">
                                  {i + 1}
                                </Mono>
                              }
                            >
                              <Text as="p" size="read-sm">
                                “{promise.text}”
                              </Text>
                            </LedgerRow>
                          ))}
                        </Ledger>
                      </Stack>
                    )}
                  </Card>
                </Section>
              ) : null}
            </Stack>
          ) : null}

          {tab === "policy" ? (
            <ToolPolicyEditor
              policy={draft.tools}
              onChange={(tools) => set("tools", tools)}
              tools={check?.tools ?? null}
              lede="Everyone who comes here obeys this, whoever they are pretending to be. A persona can take more away; it can never put anything back."
              allowPlaceholder="get_*, list_*"
              denyPlaceholder="delete_*, updateOrg*"
              destructiveHint="A persona may be stricter than this, never looser."
              whenUnknown="Check the connection under “What it answers” and every tool the target exposes is listed here, marked reachable or blocked."
            />
          ) : null}
        </Tabs>
      </Stack>
    </FormPage>
  );
}

/** The three ways in, and what choosing each one means. */
const WAYS_IN: readonly Omit<ConditionalBranch<Draft["strategy"]>, "fields">[] = [
  {
    value: "self-signup",
    label: "They sign themselves up",
    hint: "Recommended: each person makes their own account through the target's own tool.",
  },
  {
    value: "static",
    label: "Accounts from a file I provide",
    hint: "Accounts you already hold, handed out one per person.",
  },
  {
    value: "admin-mint",
    label: "Minted by an admin SDK",
    hint: "Firebase makes each person, and a key turns what comes back into a session.",
    note: "The service account creates each person in Firebase; the Web API key turns what comes back into a session the product will accept. Both are needed — a Firebase custom token is not an ID token, and anything that verifies one will refuse it.",
  },
];

/**
 * The fields that belong to one way in. A function rather than three inline trees: what the
 * `ConditionalFieldset` needs is one branch's fields, and building them beside the branch's own
 * words is what keeps the two from drifting apart.
 */
function identityFields(
  strategy: Draft["strategy"],
  draft: Draft,
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void,
): ReactNode {
  switch (strategy) {
    case "self-signup":
      return (
        <Stack gap={6}>
          <Field label="Sign-up tool" hint="The tool that creates an account.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={draft.signupTool}
                onChange={(v) => set("signupTool", v)}
                placeholder="sign_up"
                mono
              />
            )}
          </Field>
          <FieldGrid cols={2}>
            <Field label="Where the token comes back" hint="Dotted path into the result.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.tokenPath}
                  onChange={(v) => set("tokenPath", v)}
                  placeholder="token"
                  mono
                />
              )}
            </Field>
            <Field label="Where the account id comes back" optional>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.userIdPath}
                  onChange={(v) => set("userIdPath", v)}
                  placeholder="user.id"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
          <FieldGrid cols={2}>
            <Field
              label="Tool that deletes an account"
              hint="Used to clean up afterwards. Without it, accounts have to be removed by hand."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.teardownTool}
                  onChange={(v) => set("teardownTool", v)}
                  placeholder="delete_account"
                  mono
                />
              )}
            </Field>
            <Field
              label="Email domain"
              hint="Every address carries the execution's tag, so a sweep can find them again."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.emailDomain}
                  onChange={(v) => set("emailDomain", v)}
                  mono
                />
              )}
            </Field>
          </FieldGrid>
        </Stack>
      );
    case "static":
      return (
        <Field
          label="Accounts file"
          hint={'JSON keyed by cohort — { "byCohort": { "<cohort slug>": [ { "bearerToken": "..." } ] } } — with one entry per person. These accounts are yours: a clean-up leaves them alone.'}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={draft.staticFile}
              onChange={(v) => set("staticFile", v)}
              placeholder="accounts.json"
              mono
            />
          )}
        </Field>
      );
    case "admin-mint":
      return (
        <Stack gap={6}>
          <SecretField
            label="Web API key"
            stored={draft.apiKeySet}
            value={draft.apiKey}
            onChange={(v) => set("apiKey", v)}
            hint="Firebase console → Project settings → General → Web API Key. Used to exchange the custom token and to renew it every hour."
          />
          <FieldGrid cols={2}>
            <Field
              label="Service account file"
              hint="Path to the JSON key. Leave empty to use GOOGLE_APPLICATION_CREDENTIALS."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.serviceAccountFile}
                  onChange={(v) => set("serviceAccountFile", v)}
                  placeholder="./service-account.json"
                  mono
                />
              )}
            </Field>
            <Field label="Firebase project" optional hint="Only needed when the credentials do not name one.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.firebaseProjectId}
                  onChange={(v) => set("firebaseProjectId", v)}
                  placeholder="my-app-staging"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
          <FieldGrid cols={2}>
            <Field
              label="Email domain"
              hint="Every address carries the execution's tag, so a sweep can find them again."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.emailDomain}
                  onChange={(v) => set("emailDomain", v)}
                  mono
                />
              )}
            </Field>
            <Field
              label="Exchange endpoint"
              optional
              hint="An endpoint of your own that turns a custom token into the bearer your product accepts. Set one and it replaces Google's exchange entirely — sessions are renewed through it too, never through Google."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.exchangeUrl}
                  onChange={(v) => set("exchangeUrl", v)}
                  placeholder="https://…"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
        </Stack>
      );
  }
}
