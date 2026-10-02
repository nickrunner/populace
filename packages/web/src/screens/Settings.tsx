import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GithubConnectionSchema, type FindingKind, type Severity } from "@populace/core/isomorphic";
import type { GithubConnectionInput } from "@populace/contract";
import { api, type GithubCheck, type GithubConnection, type Settings as SettingsView } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject } from "../context.jsx";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Code,
  ConfirmButton,
  Field,
  FieldError,
  FieldGrid,
  FormPage,
  Inline,
  Link,
  Input,
  Measure,
  NumberInput,
  PageHeader,
  PayloadBlock,
  RelativeTime,
  SecretField,
  Section,
  Select,
  Skeleton,
  Stack,
  StateBlock,
  Switch,
  TagListField,
  Text,
  WhatWentWrong,
  type SelectOption,
  type StateKind,
} from "../design/index.js";

const MODELS: readonly { value: string; label: string }[] = [
  { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
];

const EFFORTS: readonly { value: string; label: string }[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
].map((effort) => ({ value: effort, label: effort }));

/**
 * The three judges, and which credential each one needs from the ENVIRONMENT rather than from this
 * form. `null` is the free one, which needs nothing and is why it is always available.
 */
const JUDGES: readonly { value: string; label: string; needs: "model" | "typed" | null }[] = [
  { value: "model", label: "Ask a model to judge the replay", needs: "model" },
  { value: "typesafe", label: "Ask for a typed judgement — new, and far cheaper", needs: "typed" },
  { value: "heuristic", label: "Compare the replay mechanically (free)", needs: null },
];

/** The environment variable each judge reads its own key out of, named because that is the fix. */
const JUDGE_KEYS: Record<"model" | "typed", string> = { model: "ANTHROPIC_API_KEY", typed: "TYPESAFE_API_KEY" };

/**
 * The judge options, with any judge this install has no key for held at a bound and the reason in
 * its own label.
 *
 * It is a bound and not a hidden option, and the sentence is on the option itself, because of what
 * happens when the choice goes wrong: a judge with no key does not degrade to the free one, it
 * REFUSES (`judgeRefusal`), and the refusal it makes is the error on a job row. So choosing the
 * typed judge on an install with no `TYPESAFE_API_KEY` used to break every automatic report cycle
 * of every study, for as long as they ran, and the only place it said so was somewhere nobody is
 * looking. An option that cannot work has to say so where it is chosen.
 *
 * Exported and pure so it is asserted directly: this package has no component-rendering tests.
 */
export function judgeOptions(has: { model: boolean; typed: boolean }): SelectOption[] {
  return JUDGES.map((judge) => {
    if (judge.needs === null || has[judge.needs]) return { value: judge.value, label: judge.label };
    return { value: judge.value, label: `${judge.label} — this install has no ${JUDGE_KEYS[judge.needs]}`, disabled: true };
  });
}

/**
 * What to say beside the judge picker: the missing key FIRST when there is one, because a price is
 * beside the point for a judge that will refuse, and the cost otherwise.
 *
 * A judge already chosen without its key is the case this exists for — a saved setting, a file, or
 * an install that lost the variable — and it cannot be reached through the bound above.
 */
export function judgeWarning(judge: string, has: { model: boolean; typed: boolean }): string | undefined {
  const needs = JUDGES.find((one) => one.value === judge)?.needs ?? null;
  if (needs !== null && !has[needs]) {
    return `This install has no ${JUDGE_KEYS[needs]}, so this judge cannot run: every digest and every automatic report cycle will refuse rather than check anything, and say so only on the job that failed. Set it in the environment and restart, or choose the mechanical judge below it.`;
  }
  return JUDGE_COST[judge];
}

/**
 * What the report cycle's judge costs, said in the one place somebody chooses to let it run
 * unattended.
 *
 * The numbers come from the price table and the shape of the request — roughly five thousand
 * tokens of evidence per problem, up to fifty problems a digest — and not from a measurement,
 * which is why the sentence says so. They are worth spelling out because the expensive answer is
 * the DEFAULT: `judge: "model"` resolves to the strongest model at high effort, deliberately, and
 * a price that is defensible for a digest somebody asked for is a different thing entirely when
 * it repeats by itself for as long as a study runs.
 */
const JUDGE_COST: Record<string, string> = {
  model:
    "Opus 5 at high effort, on up to 50 problems a cycle. On the price table's own arithmetic — about five thousand tokens of evidence a problem, at $5 a million in and $25 a million out with thinking on — that is order of $3 every cycle, for as long as the study runs. These are estimates from the price list, not measured figures.",
  typesafe:
    "A typed judgement instead of a written one: two narrow questions over the same evidence, at $0.042 a million tokens in and nothing for output. Order of a penny a cycle. It is new, and not yet calibrated against the mechanical judge — until it is, treat a verdict from it as worth less than the one above.",
  heuristic:
    "Nothing. The replay is compared mechanically, no model is called, and everything it cannot settle on its own is left without a verdict rather than guessed at.",
};

/**
 * The finding kinds the automatic path may file, in the reader's words — `SeverityTag`'s
 * vocabulary, so a kind is called the same thing here as on the card it came from.
 *
 * `praise` is absent on purpose and cannot be added: somebody saying the product did well is not
 * something to open an issue about, and the publisher passes it over whatever is ticked here.
 */
const FILEABLE_KINDS: readonly { value: FindingKind; label: string; hint: string }[] = [
  { value: "bug", label: "Bugs", hint: "The product did something other than what it said it would." },
  { value: "coverage-gap", label: "Gaps", hint: "Something the product promises with no tool to do it through." },
  { value: "abandonment", label: "People who walked away", hint: "Somebody gave up on what they came to do. There is nothing to replay, so a confirmed verdict is rare." },
  { value: "friction", label: "Friction", hint: "It worked, and it was harder than it should have been. Off by default: real, and not what you want forty of overnight." },
  { value: "suggestion", label: "Suggestions", hint: "Somebody wanted something the product does not offer. Off by default, for the same reason." },
];

/** `minSeverity` is a floor, so each option says what it lets through rather than naming a level. */
const MIN_SEVERITIES: readonly { value: Severity; label: string }[] = [
  { value: "critical", label: "critical only" },
  { value: "high", label: "high and above" },
  { value: "medium", label: "medium and above" },
  { value: "low", label: "everything, low included" },
];

/**
 * The connection form's own state, which is NOT the view the server sends back.
 *
 * The difference is the token, and it is the whole reason this shape exists (ADR-0040). A stored
 * token never comes back down, so the view carries `tokenSet: boolean` and this carries a string
 * that is only ever empty or newly typed. The three cases the server implements are the three this
 * form has to be careful not to fight: **an absent token keeps the stored one, the empty string
 * clears it, a value replaces it.** So `token: ""` sends no token at all — the field the reader
 * was shown empty must not travel back up and wipe a working credential — and clearing one is the
 * Forget control below, which removes the connection and the token together.
 */
interface GithubDraft {
  repo: string;
  /** Typed in this session, and only ever on its way up. Empty means "keep whatever is stored". */
  token: string;
  autoFile: boolean;
  labels: readonly string[];
  kinds: readonly FindingKind[];
  minSeverity: Severity;
  onlyConfirmed: boolean;
}

/**
 * The form for a project with no connection yet. The values match the stored schema's defaults, so
 * a reader who types a repository and saves gets what the server would have given them anyway —
 * and the form does not look like it is proposing something else.
 */
const BLANK_CONNECTION: GithubDraft = {
  repo: "",
  token: "",
  autoFile: false,
  labels: ["populace"],
  kinds: ["bug", "coverage-gap", "abandonment"],
  minSeverity: "medium",
  onlyConfirmed: false,
};

const draftOf = (connection: GithubConnection | null): GithubDraft =>
  connection === null
    ? BLANK_CONNECTION
    : {
        repo: connection.repo,
        // Never the stored token, because there is none to have: `tokenSet` is all the view says.
        token: "",
        autoFile: connection.autoFile,
        labels: connection.labels,
        kinds: connection.filter.kinds,
        minSeverity: connection.filter.minSeverity,
        onlyConfirmed: connection.filter.onlyConfirmed,
      };

/**
 * What a save would send, for the dirty comparison. The token is deliberately not in it: whether
 * one was typed is a separate question, asked directly, because a token is never compared against
 * anything — there is nothing to compare it to.
 */
const connectionShape = (draft: GithubDraft): string =>
  JSON.stringify([draft.repo.trim(), draft.autoFile, draft.labels, draft.kinds, draft.minSeverity, draft.onlyConfirmed]);

/**
 * The draft as a patch. The token is present only when something was typed, which is the whole
 * contract: absent keeps the stored one, and the empty field the reader was shown is an absence
 * rather than an instruction to clear.
 *
 * `filter` is sent whole because this form holds all three of its fields; the body's filter
 * carries no defaults, so a partial one would be a patch inside a patch and the server would have
 * to guess which halves were meant.
 */
const githubPatch = (draft: GithubDraft): GithubConnectionInput => ({
  repo: draft.repo.trim(),
  ...(draft.token === "" ? {} : { token: draft.token }),
  autoFile: draft.autoFile,
  labels: [...draft.labels],
  filter: { kinds: [...draft.kinds], minSeverity: draft.minSeverity, onlyConfirmed: draft.onlyConfirmed },
});

/**
 * What this form actually sends. `updatedAt` and `hasApiKey` are read-only and would make the
 * page permanently dirty the moment a save came back with a newer timestamp, so the comparison
 * is over the four blocks the mutation writes and nothing else.
 */
const savedShape = (settings: SettingsView): string =>
  JSON.stringify([settings.model, settings.guardrails, settings.verifier, settings.daemon]);

/**
 * Settings: limits and spending, project-scoped. Every field here is a guardrail the runner
 * enforces, not a hint to the model (ADR-0009): the ceilings below are what actually stop an
 * execution, whatever any estimate says.
 *
 * It also holds the project's GitHub connection (ADR-0044) — the repository its problems are
 * filed into and the token that lets them be. That sits here rather than on a list-and-builder
 * pair of its own because it is not a new noun (ADR-0043): there is one per project, like the
 * ceilings above it, and connecting one is editing this project rather than authoring a thing.
 *
 * Two resources, one save bar. The bar writes the four settings blocks through `PUT /settings`
 * and the connection through `PUT /github`, in that order-reversed — the credential goes first,
 * because it is the one value on this page a reader cannot retype from what is on screen.
 */
export function Settings() {
  const { key } = useProject();
  const queries = useQueryClient();
  const settings = useQuery(q.settings(key));
  const setup = useQuery(q.setup(key));
  const connection = useQuery(q.github(key));

  const [draft, setDraft] = useState<SettingsView | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [github, setGithub] = useState<GithubDraft | null>(null);
  /** What the last check found, held here rather than in a query: asking is an act, not a read. */
  const [checked, setChecked] = useState<GithubCheck | null>(null);
  /** Named by the Check button at a bound, so the reason is reachable from the control (§6). */
  const checkReasonId = useId();

  useEffect(() => {
    if (draft === null && settings.data) setDraft(settings.data);
  }, [draft, settings.data]);

  // `isSuccess` and not `data`, because `null` is a real answer here — a project nobody has
  // connected a repository to — and a truthiness check would leave the form unseeded for ever on
  // exactly the projects that have never used this.
  useEffect(() => {
    if (github === null && connection.isSuccess) setGithub(draftOf(connection.data));
  }, [github, connection.isSuccess, connection.data]);

  /**
   * What a save actually changes, named. `invalidateQueries()` with no key refetches every live
   * query in the app — every findings page, every trace, the live execution somebody is watching
   * in another tab — to write four numbers. These are the three that hold them: the settings
   * themselves and the project overview, which prints the daily ceiling on its own screen.
   */
  /** The stored connection, or null when nobody has made one. Not a failure — an answer. */
  const connected = connection.data ?? null;
  const repoTyped = github === null ? "" : github.repo.trim();
  /*
   * Validated against the stored schema's own field rather than against a regex written out
   * again here. GitHub's rules are not obvious — a repository name may carry `.` and `_`, an
   * owner may not open with a hyphen — and a second spelling of them would be a form that either
   * refuses real repositories or lets through addresses the server will.
   */
  const repoValid = GithubConnectionSchema.shape.repo.safeParse(repoTyped).success;
  const repoError = github === null || repoTyped === "" || repoValid ? undefined : "That is not an address github.com would recognise. It is owner/name — two halves and one slash, as in nickrunner/populace.";
  /*
   * A save is offered only for a VALID connection, so an address halfway through being typed
   * neither lights the bar nor travels anywhere. A blank form on a project that has never
   * connected one is not a change at all, which is what stops this page from claiming unsaved
   * changes the moment it loads.
   */
  const githubDirty =
    github !== null && repoValid && (connected === null || github.token !== "" || connectionShape(github) !== connectionShape(draftOf(connected)));

  const save = useMutation({
    mutationFn: async (): Promise<GithubConnection | null> => {
      /*
       * The connection goes first, and the order is deliberate rather than incidental.
       *
       * A token is the one value on this page that cannot be recovered from what is on screen: the
       * ceilings are all still in their fields after a failure, and a pasted token is gone the
       * moment the form re-seeds. So it is sent before anything else can fail, and a failure here
       * stops the save with the reader's typing intact.
       *
       * It is skipped when nothing about it changed, which is what stops a save of the ceilings
       * alone from stamping `updatedAt` on a connection nobody touched.
       */
      const saved = github !== null && githubDirty ? await api.saveGithub(key, githubPatch(github)) : null;
      if (draft) await api.saveSettings(key, { model: draft.model, guardrails: draft.guardrails, verifier: draft.verifier, daemon: draft.daemon });
      return saved;
    },
    onSuccess: async (saved) => {
      // Re-seeded from the PUT's own answer rather than from a refetch: it is authoritative, it
      // arrives before any invalidation lands, and re-seeding is what empties the token field —
      // the value is stored now, so the form goes back to saying only that one is.
      if (saved !== null) setGithub(draftOf(saved));
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.settings(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.github(key) }),
      ]);
    },
  });

  /**
   * "Will this token open an issue in that repository?", in the remote's own words.
   *
   * A POST, and the body may carry a token nobody has saved yet — the same split
   * `checkProvisioning` has, and for the same reason: the non-secret half is on screen and the
   * secret half may not be, in which case an absent token means "use the stored one".
   *
   * It writes what it learned onto a saved connection — whether the repository is world-readable,
   * and when it was asked — so the connection is invalidated afterwards. The draft is separate
   * state and is not disturbed: a reader who has edited the filter and then pressed Check does not
   * lose the edit.
   */
  const check = useMutation({
    mutationFn: () => api.checkGithub(key, { repo: repoTyped, ...(github === null || github.token === "" ? {} : { token: github.token }) }),
    onSuccess: async (result) => {
      setChecked(result);
      await queries.invalidateQueries({ queryKey: keys.github(key) });
    },
  });

  const forget = useMutation({
    mutationFn: () => api.forgetGithub(key),
    onSuccess: async () => {
      setGithub(draftOf(null));
      setChecked(null);
      await queries.invalidateQueries({ queryKey: keys.github(key) });
    },
  });

  const stopEverything = useMutation({
    mutationFn: (engaged: boolean) => api.setKillSwitch(engaged),
    // The switch is machine-wide, and `setup` is where its state lives; the project overview
    // reads it too, for the banner that says nothing is going anywhere. Nothing else on the
    // machine changes the moment the switch moves — executions stop at their next turn, and the
    // screens watching one are already watching it.
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
    // Either way the question has been answered; a failure is reported beside the switch, where
    // the reader can see what the machine said rather than reading it through a scrim.
    onSettled: () => {
      setConfirmingStop(false);
    },
  });

  /*
   * The connection is part of the page's readiness, because a form seeded from nothing would
   * read as "no repository" on a project that has one — and a reader could then type over a
   * stored token by pressing Save on a form that was never filled in. `isError` is deliberately
   * NOT fatal here: the ceilings are the point of this screen and are perfectly editable without
   * github.com ever having been heard from, so a failed connection read is reported in its own
   * section rather than taking the page down.
   */
  const state: StateKind | undefined =
    settings.isError ? "failed" : settings.isPending || draft === null || connection.isPending ? "loading" : undefined;

  const dirty =
    (draft !== null && settings.data !== undefined && savedShape(draft) !== savedShape(settings.data)) || githubDirty;

  const guard = draft === null ? null : draft.guardrails;
  const setGuard = (patch: Partial<SettingsView["guardrails"]>): void => {
    if (draft === null) return;
    setDraft({ ...draft, guardrails: { ...draft.guardrails, ...patch } });
  };
  const setPerWake = (patch: Partial<SettingsView["guardrails"]["perWake"]>): void => {
    if (draft === null) return;
    setGuard({ perWake: { ...draft.guardrails.perWake, ...patch } });
  };

  const stopped = setup.data?.killSwitch.engaged === true;

  const setConnection = (patch: Partial<GithubDraft>): void => {
    if (github === null) return;
    setGithub({ ...github, ...patch });
  };
  /** Ticking a kind adds it; unticking removes it. The order is the list's, not the click's. */
  const setKind = (kind: FindingKind, on: boolean): void => {
    if (github === null) return;
    setConnection({ kinds: FILEABLE_KINDS.map((one) => one.value).filter((one) => (one === kind ? on : github.kinds.includes(one))) });
  };

  /**
   * Which credentials this INSTALL has, as the two flags the view carries and nothing more. Neither
   * key comes down the wire (ADR-0036, ADR-0040), and a boolean is all a form needs to stop
   * offering a choice that cannot work.
   */
  const hasKeys = { model: draft?.hasApiKey ?? false, typed: draft?.hasTypesafeKey ?? false };

  const body =
    draft === null || guard === null ? null : (
      <Stack gap={8}>
        {save.isError ? (
          <Stack gap={2}>
            {/*
              It no longer claims that nothing was written, because two resources are saved here
              and the connection goes first: a failure may land with it saved and the ceilings not.
              What is still true either way is that the values on screen are the reader's to send
              again — with the one exception the sentence names, since a token cannot be re-shown
              and so cannot be re-sent without being re-typed.
            */}
            <FieldError id="settings-save-error">
              Saving failed. Everything on this page is still as you left it, a token you had
              typed included, so pressing Save sends the lot again.
            </FieldError>
            <PayloadBlock caption="What came back" value={save.error.message} error />
          </Stack>
        ) : null}

        {/*
          The typed judge's key, said out loud only when this project's judge is the one that needs
          it. Unlike the model key above, it is not a fact about the whole install being useful —
          an install with no `TYPESAFE_API_KEY` and the free judge chosen is working exactly as
          intended, and a standing warning about a key nobody asked for is noise. What is NOT
          noise is a project whose judge has already been set to one that cannot run: every digest
          and every automatic report cycle refuses, and the refusal lands on a job row.
        */}
        {draft.verifier.judge === "typesafe" && !hasKeys.typed ? (
          <Card>
            <Stack gap={2} align="start">
              <Badge tone="bad">No key</Badge>
              <Text size="read" as="p">
                This project asks for a typed judgement, and this install has no{" "}
                <Code inProse>TYPESAFE_API_KEY</Code>.
              </Text>
              <Text size="read" tone="soft" as="p">
                Nothing will be checked: a judge with no key refuses rather than quietly using a
                weaker one, so every digest and every automatic report this study makes will fail
                with that reason. Set it in the environment and restart, or choose the mechanical
                judge below.
              </Text>
            </Stack>
          </Card>
        ) : null}

        {draft.hasApiKey ? null : (
          <Card>
            <Stack gap={2} align="start">
              <Badge tone="bad">No key</Badge>
              <Text size="read" as="p">
                This install has no <Code inProse>ANTHROPIC_API_KEY</Code>.
              </Text>
              <Text size="read" tone="soft" as="p">
                The dashboard works without one, but nobody can visit anything: a person is a
                sequence of model calls. Set it in the environment and restart.
              </Text>
            </Stack>
          </Card>
        )}

        <Section title="Spending">
          <Card>
            <FieldGrid cols={3}>
              <Field label="Per visit, dollars" hint="A visit that reaches this stops where it is.">
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={guard.perWake.maxUsd}
                    onChange={(v) => setPerWake({ maxUsd: v })}
                    step={0.5}
                  />
                )}
              </Field>
              <Field
                label="Per visit, turns"
                hint="How many times someone may think before they have to stop."
              >
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={guard.perWake.maxTurns}
                    onChange={(v) => setPerWake({ maxTurns: v })}
                  />
                )}
              </Field>
              <Field
                label="Daily, dollars"
                hint="Trailing 24 hours, across every execution on this machine."
              >
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={guard.dailyUsd}
                    onChange={(v) => setGuard({ dailyUsd: v })}
                    step={5}
                  />
                )}
              </Field>
            </FieldGrid>
          </Card>
        </Section>

        <Section title="Stopping everything">
          <Stack gap={4}>
            <Text size="read-sm" tone="soft" as="p">
              One switch for the whole machine. While it is on, nothing spends: visits in flight
              stop at their next turn and no execution starts.
            </Text>

            <Card>
              <Stack gap={3} align="start">
                <Switch
                  label="Stop everything"
                  checked={stopped}
                  onChange={(next) => {
                    if (next) setConfirmingStop(true);
                    else stopEverything.mutate(false);
                  }}
                  onLabel="stopped"
                  offLabel="running"
                  tone="danger"
                  disabled={setup.data === undefined || stopEverything.isPending}
                />

                {stopped && setup.data !== undefined ? (
                  <Text size="meta" tone="muted" as="p">
                    Stopped <RelativeTime at={setup.data.killSwitch.at} mode="ago" />
                    {setup.data.killSwitch.reason === null
                      ? "."
                      : `, because: ${setup.data.killSwitch.reason}`}
                  </Text>
                ) : null}

                {stopEverything.isError ? (
                  <Stack gap={2} align="start">
                    <FieldError id="kill-switch-error">
                      The switch did not move. It is still showing what the machine last told us.
                    </FieldError>
                    <PayloadBlock
                      caption="What came back"
                      value={stopEverything.error.message}
                      error
                    />
                  </Stack>
                ) : null}
              </Stack>
            </Card>
          </Stack>
        </Section>

        <Section title="Who does the thinking">
          <Stack gap={4}>
            <Text size="read-sm" tone="soft" as="p">
              The people, and the judge that checks what they file.
            </Text>

            <FieldGrid cols={2}>
              <Card>
                <CardHeader title="The people" />
                <Stack gap={4}>
                  <Field label="Model">
                    {({ id, describedBy, invalid }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.model.model}
                        onChange={(v) => setDraft({ ...draft, model: { ...draft.model, model: v } })}
                        options={MODELS}
                      />
                    )}
                  </Field>
                  <Field label="Effort">
                    {({ id, describedBy, invalid }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.model.effort}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            model: { ...draft.model, effort: v as SettingsView["model"]["effort"] },
                          })
                        }
                        options={EFFORTS}
                      />
                    )}
                  </Field>
                </Stack>
              </Card>

              <Card>
                <CardHeader title="The judge" />
                <Stack gap={4}>
                  <Field
                    label="How findings are checked"
                    hint="The judge replays a finding's tool calls against the target and rules on what came back."
                    warning={judgeWarning(draft.verifier.judge, hasKeys)}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.verifier.judge}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            verifier: {
                              ...draft.verifier,
                              judge: v as SettingsView["verifier"]["judge"],
                            },
                          })
                        }
                        options={judgeOptions(hasKeys)}
                      />
                    )}
                  </Field>
                  {/*
                    The warning is said rather than the field being hidden: one that goes quietly
                    dead leaves a reader believing they chose the model the judge above ignores.
                  */}
                  <Field
                    label="Model"
                    hint="The judge decides what reaches the digest, so it is worth running stronger than the people it judges."
                    warning={draft.verifier.judge === "model" ? undefined : "The judge chosen above names its own, so this is not consulted."}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={draft.verifier.model.model ?? draft.model.model}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            verifier: {
                              ...draft.verifier,
                              model: { ...draft.verifier.model, model: v },
                            },
                          })
                        }
                        options={MODELS}
                      />
                    )}
                  </Field>
                </Stack>
              </Card>
            </FieldGrid>
          </Stack>
        </Section>

        {github === null ? null : (
          <Section title="Filing problems as GitHub issues">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                One repository for this project. A problem that survives the digest becomes an
                issue whose body is the whole reproduction — the calls, the evidence, how many
                people hit it and what they were trying to do — so somebody with no populace
                access can act on it. The same problem is not filed twice: when it is reported
                again, populace comments on the issue it already has.
              </Text>

              {connection.isError ? (
                <WhatWentWrong says="populace could not read this project's repository connection. Nothing below has been sent anywhere." error={connection.error} />
              ) : null}

              <Card>
                <CardHeader title="The repository" />
                <Stack gap={6}>
                  <FieldGrid cols={2}>
                    <Field
                      label="Repository"
                      hint="owner/name, as github.com spells it."
                      error={repoError}
                      warning={connected !== null && repoTyped === "" ? "Leaving this empty changes nothing. To remove the repository and its token, forget the connection below." : undefined}
                    >
                      {({ id, describedBy, invalid }) => (
                        <Input
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={github.repo}
                          onChange={(repo) => {
                            setConnection({ repo });
                          }}
                          mono
                          placeholder="owner/name"
                          autoComplete="off"
                        />
                      )}
                    </Field>
                    {/*
                      Write-only, which is the rule and not a precaution (ADR-0040): the token goes
                      up once and is never sent back down, so this field arrives empty on a
                      connection that has one and the line beneath says so in words. Blank keeps
                      what is stored, a value replaces it, and removing one is the Forget control.
                    */}
                    <SecretField
                      stored={connected?.tokenSet === true}
                      value={github.token}
                      onChange={(token) => {
                        setConnection({ token });
                      }}
                      label="Token"
                      hint="A fine-grained token. GitHub calls the one permission it needs Issues: Read and write."
                    />
                  </FieldGrid>

                  <Text size="read-sm" tone="soft" as="p">
                    {connected?.tokenSet === true
                      ? "A token is stored. populace will not show it to you again, here or anywhere — type a new one above to replace it, or forget the connection to remove it."
                      : "No token is stored yet. Whatever you paste above goes up once and never comes back down: populace will say that one is stored and will never show it again."}
                  </Text>

                  {/*
                    WHERE TO GET ONE, said on the screen that asks for it.

                    The field above describes the token it wants, which is not the same as telling
                    somebody how to make one. A reader who has never cut a fine-grained token has to
                    find the page, work out that "Only select repositories" is the right radio, and
                    guess which of GitHub's several dozen permissions is the one. Naming the steps in
                    GITHUB'S OWN WORDS is the difference between a field somebody fills in and a
                    field somebody abandons -- and this is the only screen in populace that asks for
                    a credential the reader has to go and manufacture somewhere else.

                    Shown only until a token is stored: afterwards it is clutter standing where the
                    Check outcome wants to be, and the link under this card covers somebody coming
                    back to rotate one.
                  */}
                  {connected?.tokenSet === true ? null : (
                    <Measure width="read">
                      <Stack gap={2}>
                        <Text size="read-sm" as="p">
                          <Link href="https://github.com/settings/personal-access-tokens/new" size="read-sm">
                            Make one on github.com
                          </Link>
                          , then set three things and copy it:
                        </Text>
                        <Text size="read-sm" tone="soft" as="p">
                          <strong>Resource owner</strong> — you, or the organisation that owns the
                          repository. <strong>Repository access</strong> — Only select repositories,
                          and pick the one. <strong>Permissions → Repository permissions → Issues</strong>{" "}
                          — Read and write. GitHub adds Metadata: Read-only by itself and will not let
                          you remove it; that is normal. It shows the token once.
                        </Text>
                      </Stack>
                    </Measure>
                  )}

                  <Stack gap={2}>
                    <Inline gap={3} align="center">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          check.mutate();
                        }}
                        pending={check.isPending}
                        atBound={!repoValid}
                        aria-describedby={repoValid ? undefined : checkReasonId}
                      >
                        Check this repository
                      </Button>
                      <Text size="meta" tone="muted" id={checkReasonId}>
                        {repoValid
                          ? "It asks github.com whether that token can open an issue there. Nothing is filed."
                          : "Fill in the repository above first, as owner/name."}
                      </Text>
                    </Inline>
                    {check.isError ? <WhatWentWrong says="populace could not ask github.com. Nothing was filed." error={check.error} /> : null}
                    {checked === null ? <StoredCheck connection={connected} /> : <WhatGithubSaid found={checked} />}
                  </Stack>

                  {/*
                    The organisation case, named here because it is indistinguishable from a bad
                    token and is the most likely reason a reader who did everything right is
                    refused: an organisation can switch fine-grained tokens off entirely, and can
                    require an owner to APPROVE one before it works. Until approved the token
                    exists and is refused, which reads exactly like a typo. Said beside the Check
                    rather than only in the doc, because this is where somebody finds out.
                  */}
                  <Measure width="read">
                    <Text size="read-sm" tone="soft" as="p">
                      Refused on a repository you can plainly open? If an organisation owns it, it may
                      have fine-grained tokens switched off, or need an owner to approve this one
                      first. The whole thing is written out in{" "}
                      <Link href="https://github.com/nickrunner/populace/blob/main/docs/ISSUE-FILING.md" size="read-sm">
                        filing problems as issues
                      </Link>
                      , including what ends up in the issue and what filing by itself will spend.
                    </Text>
                  </Measure>

                  {connected === null ? null : (
                    <Inline gap={3} align="center">
                      <ConfirmButton
                        title="Forget this repository?"
                        body={
                          <>
                            populace forgets {connected.repo} and the token with it, and files
                            nothing anywhere until a repository is connected again. The issues it
                            has already opened stay exactly where they are — github.com is not
                            told — and so does its record of which problem went to which issue, so
                            connecting the same repository later does not file everything a second
                            time.
                          </>
                        }
                        confirmLabel="Forget it"
                        onConfirm={() => {
                          forget.mutate();
                        }}
                        pending={forget.isPending}
                      >
                        Forget this repository
                      </ConfirmButton>
                      {forget.isError ? <WhatWentWrong says="populace could not forget the connection. It is still there, token and all." error={forget.error} /> : null}
                    </Inline>
                  )}
                </Stack>
              </Card>

              <Card>
                <CardHeader title="Filing by itself" />
                <Stack gap={6}>
                  <Stack gap={3} align="start">
                    <Switch
                      label="File what a study finds, without being asked"
                      checked={github.autoFile}
                      onChange={(autoFile) => {
                        setConnection({ autoFile });
                      }}
                      onLabel="filing"
                      offLabel="off"
                      disabled={!repoValid}
                    />
                    <Text size="meta" tone="muted" as="p">
                      {repoValid
                        ? "A longitudinal execution reports on a cycle, for as long as it runs; an ephemeral one reports when it finishes. Either way it builds a digest first, so a verdict reaches the issue with the problem."
                        : "There is nowhere to file yet. Fill in a repository above, and check it."}
                    </Text>
                  </Stack>

                  {github.autoFile ? (
                    <>
                      {/*
                        The sweep hazard, at the point of choice and not in a tooltip.
                        `docs/design/SWEEP-AND-VERIFY.md` measured it: a run ended at 02:49:13 and
                        every one of its 22 accounts was gone eleven seconds later. The judge
                        re-checks a problem by replaying the recorded calls AS the person who filed
                        it, and `replayFinding` refuses outright once that account is torn down —
                        so an ephemeral study that sweeps has destroyed its own verifiability, and
                        the doc's standing complaint is that nothing says so. This is the something.
                        It assumes sweeping is what a study actually gets, because a study row's
                        own default is on.
                      */}
                      <Stack gap={2} align="start">
                        <Badge tone="bad">Ephemeral studies sweep up</Badge>
                        <Text size="read" tone="critical" as="p">
                          An ephemeral study deletes the accounts it made on the target when the
                          execution ends, and that is its default. The judge checks a problem by
                          replaying the calls as the person who filed it, and once their account is
                          gone it cannot — so every problem filed from a swept execution carries a
                          verdict that can never be checked again, by populace or by anybody else.
                        </Text>
                        <Text size="read-sm" tone="soft" as="p">
                          If you are filing from an ephemeral study, turn off &ldquo;Sweep up after
                          them&rdquo; on that study and sweep it by hand when you have finished
                          reading it. A longitudinal study is not affected: it does not end, and
                          nothing tears its accounts down underneath it.
                        </Text>
                      </Stack>

                      <Stack gap={2}>
                        <Text size="read-sm" as="p">
                          What a cycle costs: each one builds a digest, and the digest is where the
                          money goes — the judge above, on every problem with no verdict yet.
                        </Text>
                        <Text size="read-sm" tone="soft" as="p">
                          {JUDGE_COST[draft.verifier.judge]}
                        </Text>
                        <Text size="meta" tone="muted" as="p">
                          The per-visit and daily ceilings at the top of this page still apply, and
                          publishing itself calls no model and costs nothing at all.
                        </Text>
                      </Stack>
                    </>
                  ) : null}

                  <Stack gap={3} align="start">
                    <Text size="read-sm" tone="soft" as="p">
                      What may go out. This narrows and never widens: praise is never filed, nor a
                      problem somebody has already settled on the triage control, nor one this
                      execution did not report, nor one that already has an issue — whatever is
                      ticked here.
                    </Text>
                    {FILEABLE_KINDS.map((kind) => (
                      <Checkbox
                        key={kind.value}
                        checked={github.kinds.includes(kind.value)}
                        onChange={(on) => {
                          setKind(kind.value, on);
                        }}
                        label={kind.label}
                        hint={kind.hint}
                      />
                    ))}
                  </Stack>

                  <FieldGrid cols={2}>
                    <Field label="Severity worth filing" hint="A floor, read off the problem as the digest clustered it.">
                      {({ id, describedBy, invalid }) => (
                        <Select
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={github.minSeverity}
                          onChange={(v) => {
                            const chosen = MIN_SEVERITIES.find((one) => one.value === v);
                            if (chosen !== undefined) setConnection({ minSeverity: chosen.value });
                          }}
                          options={MIN_SEVERITIES}
                        />
                      )}
                    </Field>
                    <TagListField
                      value={github.labels}
                      onChange={(labels) => {
                        setConnection({ labels });
                      }}
                      label="Labels on every issue"
                      hint="Comma-separated. Created in the repository first if they are not there already — so a label something else watches for is how a filed issue gets picked up."
                      placeholder="populace, claude"
                    />
                  </FieldGrid>

                  <Checkbox
                    checked={github.onlyConfirmed}
                    onChange={(onlyConfirmed) => {
                      setConnection({ onlyConfirmed });
                    }}
                    label="Only file what the judge confirmed"
                    hint="Off by default, and worth leaving off: a gap is settled mechanically and somebody walking away has nothing to replay, so this drops whole kinds rather than raising the bar on them."
                  />
                </Stack>
              </Card>
            </Stack>
          </Section>
        )}
      </Stack>
    );

  return (
    <>
      <FormPage
        header={
          <PageHeader
            title="Settings"
            lede="What an execution is allowed to cost, how often the people come back, and which models they and the judge run on. These are enforced while an execution is going, not suggested to it."
          />
        }
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="your limits"
            skeleton={
              <Skeleton variant="block" height={132} count={3} label="Reading your limits" />
            }
          />
        }
        error={
          <StateBlock
            kind="failed"
            what="your limits"
            error={settings.error}
          />
        }
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        savedAt={settings.data?.updatedAt ?? null}
      >
        {body}
      </FormPage>

      {/*
        The confirm before the machine goes quiet, and the product's most destructive control, so
        it is announced as `alertdialog` and does not close on a click on the scrim. It shipped as
        a `Dialog` only because the thing that opens it is a `Switch` rather than a slotted
        button; `AlertDialog` now takes a controlled `open`, which is exactly that case, and
        `confirmPending` keeps the panel up while the switch is in flight — `onSettled` closes it
        either way, so a failure is read beside the switch rather than through a scrim.
      */}
      <AlertDialog
        open={confirmingStop}
        onOpenChange={setConfirmingStop}
        title="Stop everything on this machine?"
        body={
          <>
            Every execution stops at its next turn and none starts again until you turn this back
            off. Findings already filed stay where they are, and turning it back off does not
            resume anything on its own — you send the people in again yourself.
          </>
        }
        confirmLabel="Stop everything"
        confirmPending={stopEverything.isPending}
        onConfirm={() => stopEverything.mutate(true)}
      />
    </>
  );
}

/**
 * Whether the repository is world-readable, in words. `unknown` is its own state and not a guess:
 * nobody has asked github.com yet, and reading that as "private" is how an unchecked repository
 * comes to look safe.
 */
const VISIBILITY_WORDS: Record<GithubConnection["visibility"], string> = {
  private: "private repository",
  public: "public repository",
  unknown: "not checked yet",
};

/**
 * The five outcomes as a badge's word, in github.com's own register rather than in ours. Each one
 * is a different thing for the reader to do, which is why they are five and not "worked" and
 * "failed": a token with the wrong scope, a token past its expiry and a repository with its issue
 * tracker switched off would otherwise all read as one problem with one wrong fix.
 */
const CHECK_WORDS: Record<GithubCheck["outcome"], string> = {
  ready: "ready",
  unreachable: "no answer",
  refused: "refused",
  "no-issues": "issues switched off",
  expired: "token expired",
};

/**
 * What a check found, in the register the target wizard's own check uses (DESIGN-SYSTEM §7.4):
 * the product's sentence, and the machine's words in the one well beneath when there are any.
 *
 * A public repository is stated as such because it changes what populace publishes rather than
 * how it feels about publishing it — an issue body carries the target's address and every hit
 * cohort's brief, and on a public repository the address is reduced to its bare host.
 */
function WhatGithubSaid({ found }: { found: GithubCheck }): ReactNode {
  return (
    <Stack gap={2}>
      <Inline gap={2} align="center" wrap>
        <Badge tone={found.outcome === "ready" ? "good" : "bad"}>{CHECK_WORDS[found.outcome]}</Badge>
        {found.visibility === "unknown" ? null : (
          <Badge tone={found.visibility === "public" ? "warn" : "neutral"}>{VISIBILITY_WORDS[found.visibility]}</Badge>
        )}
      </Inline>
      <Text size="read" tone={found.outcome === "ready" ? "ink" : "critical"} as="p">
        {found.summary}
      </Text>
      {found.expiresAt === null ? null : (
        <Text size="meta" tone="muted" as="p">
          This token expires <RelativeTime at={found.expiresAt} mode="countdown" />. populace
          cannot renew it, and filing stops the moment it goes.
        </Text>
      )}
      {found.detail === null ? null : <PayloadBlock caption="What github.com said" value={found.detail} error />}
    </Stack>
  );
}

/**
 * What the LAST check found, for a reader who has not pressed the button in this session.
 *
 * It says nothing at all until one has reached the repository: `checkedAt` is written only when
 * github.com answered, so a null one means the question has never been put — and a line saying
 * "not checked" beside a stored connection that works would be a screen inventing a state.
 */
function StoredCheck({ connection }: { connection: GithubConnection | null }): ReactNode {
  if (connection === null || connection.checkedAt === null) return null;
  return (
    <Inline gap={2} align="center" wrap>
      <Badge tone={connection.visibility === "public" ? "warn" : "neutral"}>{VISIBILITY_WORDS[connection.visibility]}</Badge>
      <Text size="meta" tone="muted">
        Checked <RelativeTime at={connection.checkedAt} mode="ago" />
        {connection.visibility === "public"
          ? ". Anybody can read an issue filed there, and an issue carries the target's address and what the people were told."
          : "."}
      </Text>
    </Inline>
  );
}
