import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Settings as SettingsView } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject } from "../context.jsx";
import {
  AlertDialog,
  Badge,
  Card,
  CardHeader,
  Code,
  Field,
  FieldError,
  FieldGrid,
  FormPage,
  NumberInput,
  PageHeader,
  PayloadBlock,
  RelativeTime,
  Section,
  Select,
  Skeleton,
  Stack,
  StateBlock,
  Switch,
  Text,
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

const JUDGES: readonly { value: string; label: string }[] = [
  { value: "model", label: "Ask a model to judge the replay" },
  { value: "heuristic", label: "Compare the replay mechanically (free)" },
];

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
 */
export function Settings() {
  const { key } = useProject();
  const queries = useQueryClient();
  const settings = useQuery(q.settings(key));
  const setup = useQuery(q.setup(key));

  const [draft, setDraft] = useState<SettingsView | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  useEffect(() => {
    if (draft === null && settings.data) setDraft(settings.data);
  }, [draft, settings.data]);

  /**
   * What a save actually changes, named. `invalidateQueries()` with no key refetches every live
   * query in the app — every findings page, every trace, the live execution somebody is watching
   * in another tab — to write four numbers. These are the three that hold them: the settings
   * themselves and the project overview, which prints the daily ceiling on its own screen.
   */
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.saveSettings(key, { model: draft.model, guardrails: draft.guardrails, verifier: draft.verifier, daemon: draft.daemon });
    },
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.settings(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
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

  const state: StateKind | undefined =
    settings.isError ? "failed" : settings.isPending || draft === null ? "loading" : undefined;

  const dirty = draft !== null && settings.data !== undefined && savedShape(draft) !== savedShape(settings.data);

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

  const body =
    draft === null || guard === null ? null : (
      <Stack gap={8}>
        {save.isError ? (
          <Stack gap={2}>
            <FieldError id="settings-save-error">
              Saving failed. Nothing on this page was written; the values below are still yours to
              send again.
            </FieldError>
            <PayloadBlock caption="What came back" value={save.error.message} error />
          </Stack>
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
                        options={JUDGES}
                      />
                    )}
                  </Field>
                  <Field
                    label="Model"
                    hint="The judge decides what reaches the digest, so it is worth running stronger than the people it judges."
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
