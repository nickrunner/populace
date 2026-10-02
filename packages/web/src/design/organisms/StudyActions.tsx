import { forwardRef, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { api, type StudySummary } from "../../api.js";
import { useProject } from "../../context.jsx";
import { people, plural } from "../../format.js";
import { familyOf, keys } from "../../queries.js";
import { Button, Checkbox, Inline, Link, Measure, Stack, Text } from "../atoms/index.js";
import { ConfirmButton, FieldWarning } from "../molecules/index.js";
import { AlertDialog } from "./AlertDialog.js";
import { WhatWentWrong } from "./WhatWentWrong.js";

/**
 * StudyActions — the one action a study is asking for, in the words its mode makes true
 * (ATOMIC-INVENTORY §5, "shared non-route components"; DESIGN-SYSTEM §7.4).
 *
 * **Why it is of the system rather than beside it.** It was the last legacy component a screen
 * still reached for, and that is exactly what broke `ProjectHome`: the old component drew its
 * primary button as `bg-accent text-white border-accent`, so `bg-accent` was lime, `text-white`
 * was white, and "Send them in" rendered white on lime at 1.22:1 on the project's most important
 * screen. Every variant here is written against a token, which is the rule that makes that
 * impossible rather than merely unlikely.
 *
 * **It owns its own mutations, and it is the only thing in `design/` that does.** The inventory
 * calls it an organism with two call sites — the studies dashboard's row and the study's results
 * page — and both of them want one line. A presentational version would push six mutations, a
 * navigate and an invalidation into every screen that shows a study, which is how the two call
 * sites drifted apart in the first place. The dependency is declared here rather than hidden:
 * `api`, the query keys, the project context, and nothing else.
 *
 * **Ephemeral and longitudinal differ here and nowhere else in the controls.** An ephemeral
 * execution is bounded, so it is stopped and then run again as a sibling; a longitudinal one is a
 * life, so it is paused and picked back up on the same execution — and while it is running or
 * paused, a change to the study reaches the people in it only through "Apply to the running
 * execution" (SPEC §4.2), which re-resolves and re-snapshots that execution. "Run it again" is
 * deliberately not offered for a longitudinal study — starting over would throw away the history
 * that is the whole reason it is longitudinal.
 *
 * **Four buttons, three shells** (§1.2):
 *
 *  - Starting spends real money, so every act that sends people in goes through a
 *    `ConfirmButton` — the same question `Preflight` asks, asked from wherever the reader
 *    pressed it, with the headcount and the target in it and no promise about what comes back
 *    (§7.3). A study whose deal sends nobody cannot start, and the button is at a bound with the
 *    reason rather than gone (§6.5): the server would refuse with the same sentence.
 *  - Pausing and applying are `secondary`: one stops the spending and takes nothing away, the
 *    other changes what the next visits are told and takes nothing away either.
 *  - The act that *ends* an execution is the stop tone the system defines for it — `danger`,
 *    critical ink on a critical hairline, never a filled red button.
 *
 * **Deleting archives, by default** (ADR-0043's delete rules). A study that has run is the record
 * of what its people found, so "Delete" takes it off the list and leaves every execution where
 * it is; the reader ticks "Delete its executions too" to take those as well, having been told
 * what that costs. People no other study sends are put aside rather than deleted (ADR-0031) and
 * come back if a study sends them again — the dialog says so, because a reader watching a
 * People page empty out would otherwise reasonably think they were gone.
 *
 * **The Delete is the caller's to decline** (`deletable`). On the study's own page it is the one
 * way off it, and it stays. On the studies dashboard the list rules give every row ONE menu for
 * edit and archive (ATOMIC-INVENTORY §3), and that menu carries the same dialog; a second Delete
 * beside it would be the same act with two names, so the row asks for the buttons and not the
 * dialog. The dialog itself is not made a shared component, because its copy is the one thing
 * about it that must not drift — both call sites say the same three sentences, and a shared
 * component would put the sentences in a third file nobody reads.
 */

export interface StudyActionsProps {
  study: StudySummary;
  /**
   * The reader is already on this study's own page, so the route to the pre-flight page is
   * noise, and deleting it means leaving it.
   */
  live?: boolean;
  /**
   * Whether this renders its own Delete. `false` when the screen around it owns the act — the
   * studies dashboard's row menu — so the same question is not asked from two buttons an inch
   * apart. Default `true`.
   */
  deletable?: boolean;
}

export const StudyActions = forwardRef<HTMLDivElement, StudyActionsProps>(
  function StudyActions({ study, live = false, deletable = true }, ref) {
    const { key, project, href } = useProject();
    const queries = useQueryClient();
    const navigate = useNavigate();
    const base = `${href()}/studies/${encodeURIComponent(study.slug)}`;
    const runId = study.latest?.runId ?? "";
    const errorId = useId();
    const boundId = useId();
    const stopId = useId();
    /**
     * The stop is one row for the whole machine, not a property of this study (ADR-0022): it is
     * engaged by "stop everything now" on ANY execution, it stays engaged after that execution
     * ends so that stopping never quietly re-arms itself, and `startOne` and `resume` both refuse
     * while it is on. So a study made minutes ago, in a project that has never run anything, is
     * held by a stop somebody pressed somewhere else — which is why the bound below says what it
     * covers rather than only that it exists.
     */
    const stopped = project.killSwitch.engaged;
    const [confirming, setConfirming] = useState(false);
    const [withRuns, setWithRuns] = useState(false);

    /**
     * What one of these acts moves: the study (status, latest, spend), the lists that carry it,
     * what is left to set up, and everything read under the study. The study-scoped keys are
     * invalidated by FAMILY, because this component knows the slug and the URL may spell the
     * study by id — the same blunt-and-correct trade `staleAfter` makes. Never
     * `invalidateQueries()` bare: that refetches a persona form nobody touched.
     */
    const refresh = async (): Promise<void> => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.studies(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
        queries.invalidateQueries({ queryKey: keys.runs(key) }),
        queries.invalidateQueries({ queryKey: familyOf(keys.study(key, study.slug)) }),
        queries.invalidateQueries({ queryKey: familyOf(keys.results(key, study.slug)) }),
        queries.invalidateQueries({ queryKey: familyOf(keys.studyRuns(key, study.slug)) }),
        queries.invalidateQueries({ queryKey: familyOf(keys.studyPeople(key, study.slug)) }),
      ]);
    };
    const start = useMutation({
      mutationFn: () => api.startStudyRun(key, study.slug, {}),
      onSuccess: async () => {
        await refresh();
        void navigate(`${base}/live`);
      },
    });
    const pause = useMutation({ mutationFn: () => api.pauseRun(runId), onSuccess: refresh });
    const resume = useMutation({ mutationFn: () => api.resumeRun(runId), onSuccess: refresh });
    const stop = useMutation({ mutationFn: () => api.stopRun(runId, "drain"), onSuccess: refresh });
    /**
     * The saved study, applied to the execution that is going. It re-resolves the roster at the
     * study's size and re-snapshots, so the next visit each person makes is under the new
     * settings; nobody mid-visit is interrupted. A 409 is the server declining — a static pool
     * too small for the new size, say — and it is shown in its own words below.
     */
    const apply = useMutation({ mutationFn: () => api.applyStudy(key, study.slug), onSuccess: refresh });
    /**
     * Releasing the stop, from where the stop is felt. Settings owns the switch and still does;
     * this is the same call, offered beside the control it is holding, because the reader who
     * meets it here has been told to release it and given nowhere to do so. It takes nothing
     * away and starts nothing — it only lets the acts above be pressed again — so it asks no
     * question, and the sentence beside it names the reach the switch actually has.
     */
    const release = useMutation({ mutationFn: () => api.setKillSwitch(false), onSuccess: refresh });
    /**
     * The one act here that takes something away rather than moving it along. `withRuns` is the
     * reader's tick, not a default: without it the row is archived and every execution stays.
     */
    const remove = useMutation({
      mutationFn: () => api.removeStudy(key, study.slug, withRuns),
      onSuccess: async () => {
        setConfirming(false);
        await refresh();
        // Only from a page that IS this study; on the project's list the row simply goes.
        if (live) void navigate(href());
      },
    });

    const busy = start.isPending || pause.isPending || resume.isPending || stop.isPending || apply.isPending || remove.isPending;

    /**
     * What failed, and what is still true, in the product's voice — the machine's own words go
     * in the well under it (§7.4). One at a time: the most recent act is the one the reader is
     * waiting on.
     */
    const failure: { says: string; error: Error } | null =
      start.error !== null
        ? { says: "They were not sent. The study is as it was.", error: start.error }
        : pause.error !== null
          ? { says: "It was not paused; the execution is still going.", error: pause.error }
          : resume.error !== null
            ? { says: "It was not picked back up.", error: resume.error }
            : stop.error !== null
              ? { says: "It was not stopped; the execution is still going.", error: stop.error }
              : apply.error !== null
                ? { says: "The running execution was not changed. The study is saved as you left it; the people in this execution take the change only through this.", error: apply.error }
                : remove.error !== null
                  ? { says: "Nothing was removed.", error: remove.error }
                  : null;

    /**
     * A study of size nought — or one whose population has a cohort with no personas to deal
     * into — sends nobody, and the server refuses to start it with this sentence. Saying it here,
     * on the button, is cheaper than a round trip to be told.
     */
    const sendsNobody = study.sends === 0;

    /**
     * What deleting it takes, and it differs by whether anything has ever run. A study that has
     * never been sent is a piece of configuration and saying so is the honest sentence; one that
     * has run is the record of what the people found, and the reader is told what stays and what
     * goes rather than being handed "this cannot be undone".
     */
    const hasRun = study.latest !== null;
    const losing = hasRun ? (
      <Stack gap={3} align="start">
        <span>
          {study.name} comes off the list. Its executions stay exactly where they are — the visits,
          what the people remembered and the problems they filed — and so do its population, its
          personas and its target, which belong to the project.
        </span>
        <Checkbox
          checked={withRuns}
          onChange={setWithRuns}
          label="Delete its executions too"
          hint={`Every execution of ${study.name} goes with it. If any of them left accounts on ${study.target.name}, the only record of those goes too.`}
        />
        <Text size="meta" tone="muted">
          People no other study sends are put aside, not deleted, and come back if a study sends
          them again.
        </Text>
      </Stack>
    ) : (
      <>
        {study.name} has never been sent, so there is nothing to lose but the settings. Its
        population, its personas and its target all stay — they belong to the project, not to
        this. People no other study sends are put aside, not deleted, and come back if a study
        sends them again.
      </>
    );

    /** What sending them in costs, in people rather than in dollars this view does not carry. */
    const sending = (
      <>
        {people(study.sends)} start visiting {study.target.name}
        {study.visitsPerPerson === null
          ? ", and they keep coming back until you pause it"
          : `, ${plural(study.visitsPerPerson, "visit")} each`}
        . This spends real money, and the ceilings in settings are what actually stop it.
      </>
    );

    /**
     * The start, in whichever words the status makes true. At a bound, not gone, when nobody
     * would go — or when everything is stopped, which the server refuses with the same sentence
     * the bound says. The stop is named first: it holds a study that is otherwise ready.
     */
    const send = (title: string, body: React.ReactNode, label: string) =>
      stopped || sendsNobody ? (
        <Button variant="primary" disabled aria-describedby={stopped ? stopId : boundId}>
          {label}
        </Button>
      ) : (
        <ConfirmButton
          title={title}
          body={body}
          confirmLabel={label}
          variant="primary"
          pending={start.isPending}
          onConfirm={() => {
            start.mutate();
          }}
        >
          <Button variant="primary" disabled={busy} pending={start.isPending}>
            {label}
          </Button>
        </ConfirmButton>
      );

    const applyButton = (
      <Button
        variant="secondary"
        disabled={busy}
        pending={apply.isPending}
        onClick={() => {
          apply.mutate();
        }}
      >
        Apply to the running execution
      </Button>
    );

    /*
      Everything below the buttons is a sentence, and this component is mounted in
      `PageHeader.actions`, an `Inline` that is `shrink-0` so a row of buttons never wraps mid-act.
      A paragraph in a slot that refuses to shrink sets the slot's width from its own longest line
      and pushes it across whatever sits beside it, so every sentence here is bound to a reading
      measure rather than left to the slot.
    */
    const sentence = (body: React.ReactNode): React.ReactNode => <Measure width="read">{body}</Measure>;

    return (
      <Stack ref={ref} gap={1} align="start">
        <Inline gap={2} align="center" wrap>
          {study.status === "never-run" ? (
            <>
              {live ? null : (
                <Button asChild variant="secondary">
                  <RouterLink to={`${base}/preflight`}>Before you send them</RouterLink>
                </Button>
              )}
              {send("Send them in?", sending, "Send them in")}
            </>
          ) : study.status === "running" ? (
            study.mode === "longitudinal" ? (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  pending={pause.isPending}
                  onClick={() => {
                    pause.mutate();
                  }}
                >
                  Pause
                </Button>
                {applyButton}
              </>
            ) : (
              // The stop tone: this one ends the execution rather than holding it.
              <Button
                variant="danger"
                disabled={busy}
                pending={stop.isPending}
                onClick={() => {
                  stop.mutate();
                }}
              >
                Let them finish, then stop
              </Button>
            )
          ) : study.status === "paused" ? (
            <>
              {/* Picking a paused execution back up is refused while everything is stopped, by
                  the same row and the same sentence as a start, so it is held the same way. */}
              <Button
                variant="primary"
                disabled={busy || stopped}
                {...(stopped ? { "aria-describedby": stopId } : {})}
                pending={resume.isPending}
                onClick={() => {
                  resume.mutate();
                }}
              >
                Pick it back up
              </Button>
              {/* A paused longitudinal execution is still a life; the change waits for it here too. */}
              {study.mode === "longitudinal" ? applyButton : null}
            </>
          ) : study.mode === "longitudinal" ? (
            send(
              "Start a new one?",
              <>
                {sending} The execution you have keeps everything it has built up; nobody in the new
                one remembers any of it.
              </>,
              "Start a new one",
            )
          ) : (
            send(
              "Run it again?",
              <>
                {sending} Everyone arrives remembering nothing, so this execution and the last one
                are independent of each other: what is compared between them is which problems came
                back, not the numbers.
              </>,
              "Run it again",
            )
          )}
          {/*
            Set off from the act the row is actually asking for: the primary button is where the
            eye lands, and a destructive control flush against it is a misclick waiting to
            happen. It is `quiet` because the question, not the colour, is what stops a mistake
            (§1.2) — and it is absent entirely while an execution is running, because deleting
            the rows a live process is writing is not a question worth asking.

            Controlled, because the dialog holds a checkbox whose state this component owns and
            because the act takes time: the panel stays up with its spinner until the server
            answers, and closes from `onSuccess`. Not rendered at all when the caller has said the
            act is its own (`deletable={false}`).
          */}
          {!deletable || study.status === "running" ? null : (
            <span className="ml-2">
              <AlertDialog
                title={`Delete ${study.name}?`}
                body={losing}
                confirmLabel={!hasRun ? "Delete this study" : withRuns ? "Delete it and its executions" : "Archive this study"}
                confirmPending={remove.isPending}
                open={confirming}
                onOpenChange={(open) => {
                  setConfirming(open);
                  if (!open) setWithRuns(false);
                }}
                onConfirm={() => {
                  remove.mutate();
                }}
                trigger={
                  <Button variant="quiet" size="sm" disabled={busy} aria-describedby={failure === null ? undefined : errorId}>
                    Delete
                  </Button>
                }
              />
            </span>
          )}
        </Inline>

        {/*
          The other bound, and the only one a reader cannot clear from the study they are on
          without this: everything on the machine is stopped. The sentence carries the reason the
          switch was given — usually the execution it was pressed on, which may belong to another
          study entirely — and says what releasing covers, because the switch is machine-wide and
          a button that read "let them go" beside one study would not be telling the truth.
        */}
        {stopped ? (
          <div id={stopId}>
            <FieldWarning>
              {/*
                Short on purpose, and inline with the control that clears it. This component is
                mounted in two slots that size themselves to their content and refuse to shrink —
                the header's `actions` Inline and the dashboard row's control cell — so a
                paragraph here does not wrap, it widens its host and squeezes everything beside
                it. "On this machine" is the reach in three words; the reason the switch was
                given is on the Settings screen that owns it, and on the dashboard's own panel.
              */}
              <Inline gap={2} align="center" wrap>
                <span>Everything on this machine is stopped.</span>
                <Button variant="secondary" size="sm" pending={release.isPending} onClick={() => release.mutate()}>
                  Release the stop
                </Button>
              </Inline>
            </FieldWarning>
          </div>
        ) : null}

        {release.isError
          ? sentence(<WhatWentWrong says="The stop is still on. Nothing has changed." error={release.error} />)
          : null}

        {/* The bound, said beside the control that is at it (§6.5): what would let them go. */}
        {sendsNobody && !stopped && study.status !== "running" && study.status !== "paused" ? (
          <div id={boundId}>
            {sentence(
              <FieldWarning>
                This study sends nobody yet: give it a size.{" "}
                <Link to={`${base}/edit`} size="ui">
                  Change the study
                </Link>
              </FieldWarning>,
            )}
          </div>
        ) : null}

        {/* What failed, in the product's voice, with the machine's words quoted under it (§7.4). */}
        {failure === null ? null : sentence(<WhatWentWrong id={errorId} says={failure.says} error={failure.error} />)}
      </Stack>
    );
  },
);
