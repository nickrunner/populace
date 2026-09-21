import { forwardRef, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { api, type SimulationSummary } from "../../api.js";
import { useProject } from "../../context.jsx";
import { people, plural } from "../../format.js";
import { Button, Inline, Stack } from "../atoms/index.js";
import { ConfirmButton, FieldError } from "../molecules/index.js";

/**
 * SimulationActions — the one action a simulation is asking for, in the words its mode makes
 * true (ATOMIC-INVENTORY §5, "shared non-route components"; DESIGN-SYSTEM §7.4).
 *
 * **Why it is of the system rather than beside it.** It was the last legacy component a screen
 * still reached for, and that is exactly what broke `ProjectHome`: the old component drew its
 * primary button as `bg-accent text-white border-accent`, so `bg-accent` was lime, `text-white`
 * was white, and "Send them in" rendered white on lime at 1.22:1 on the project's most important
 * screen. Every variant here is written against a token, which is the rule that makes that
 * impossible rather than merely unlikely.
 *
 * **It owns its own mutations, and it is the only thing in `design/` that does.** The inventory
 * calls it an organism with two call sites, and both of them want one line. A presentational
 * version would push four mutations, a navigate and an invalidation into every screen that shows
 * a simulation, which is how the two call sites drifted apart in the first place. The dependency
 * is declared here rather than hidden: `api`, the project context, and nothing else.
 *
 * **Ephemeral and longitudinal differ here and nowhere else in the controls.** An ephemeral
 * execution is bounded, so it is stopped and then run again as a sibling; a longitudinal one is a
 * life, so it is paused and picked back up on the same execution. "Run it again" is deliberately
 * not offered for a longitudinal simulation — starting over would throw away the history that is
 * the whole reason it is longitudinal.
 *
 * **Three buttons, three shells** (§1.2):
 *
 *  - Starting spends real money, so every act that sends people in goes through a
 *    `ConfirmButton` — the same question `Preflight` asks, asked from wherever the reader
 *    pressed it, with the headcount and the target in it and no promise about what comes back
 *    (§7.3).
 *  - Pausing is `secondary`: it stops the spending and takes nothing away.
 *  - The act that *ends* an execution is the stop tone the system defines for it — `danger`,
 *    critical ink on a critical hairline, never a filled red button.
 */

export interface SimulationActionsProps {
  simulation: SimulationSummary;
  /**
   * The reader is already watching this execution, so the route to the pre-flight page is noise.
   */
  live?: boolean;
}

export const SimulationActions = forwardRef<HTMLDivElement, SimulationActionsProps>(
  function SimulationActions({ simulation, live = false }, ref) {
    const { key, href } = useProject();
    const queries = useQueryClient();
    const navigate = useNavigate();
    const base = `${href()}/s/${encodeURIComponent(simulation.slug)}`;
    const runId = simulation.latest?.runId ?? "";
    const errorId = useId();

    const refresh = async (): Promise<void> => {
      await queries.invalidateQueries();
    };
    const start = useMutation({
      mutationFn: () => api.startRun(key, simulation.slug, {}),
      onSuccess: async () => {
        await refresh();
        void navigate(`${base}/live`);
      },
    });
    const pause = useMutation({ mutationFn: () => api.pauseRun(runId), onSuccess: refresh });
    const resume = useMutation({ mutationFn: () => api.resumeRun(runId), onSuccess: refresh });
    const stop = useMutation({ mutationFn: () => api.stopRun(runId, "drain"), onSuccess: refresh });

    const busy = start.isPending || pause.isPending || resume.isPending || stop.isPending;
    const error = start.error ?? pause.error ?? resume.error ?? stop.error;

    /** What sending them in costs, in people rather than in dollars this view does not carry. */
    const sending = (
      <>
        {people(simulation.population.people)} start visiting {simulation.target.name}
        {simulation.visitsPerPerson === null
          ? ", and they keep coming back until you pause it"
          : `, ${plural(simulation.visitsPerPerson, "visit")} each`}
        . This spends real money, and the ceilings in settings are what actually stop it.
      </>
    );

    return (
      <Stack ref={ref} gap={1} align="start">
        <Inline gap={2} align="center" wrap>
          {simulation.status === "never-run" ? (
            <>
              {live ? null : (
                <Button asChild variant="secondary">
                  <RouterLink to={`${base}/preflight`}>Before you send them</RouterLink>
                </Button>
              )}
              <ConfirmButton
                title="Send them in?"
                body={sending}
                confirmLabel="Send them in"
                variant="primary"
                pending={start.isPending}
                onConfirm={() => {
                  start.mutate();
                }}
              >
                <Button variant="primary" disabled={busy} pending={start.isPending}>
                  Send them in
                </Button>
              </ConfirmButton>
            </>
          ) : simulation.status === "running" ? (
            simulation.mode === "longitudinal" ? (
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
          ) : simulation.status === "paused" ? (
            <Button
              variant="primary"
              disabled={busy}
              pending={resume.isPending}
              onClick={() => {
                resume.mutate();
              }}
            >
              Pick it back up
            </Button>
          ) : simulation.mode === "longitudinal" ? (
            <ConfirmButton
              title="Start a new one?"
              body={
                <>
                  {sending} The execution you have keeps everything it has built up; nobody in the
                  new one remembers any of it.
                </>
              }
              confirmLabel="Start a new one"
              variant="primary"
              pending={start.isPending}
              onConfirm={() => {
                start.mutate();
              }}
            >
              <Button variant="primary" disabled={busy} pending={start.isPending}>
                Start a new one
              </Button>
            </ConfirmButton>
          ) : (
            <ConfirmButton
              title="Run it again?"
              body={
                <>
                  {sending} Everyone arrives remembering nothing, so this execution and the last
                  one are independent of each other: what is compared between them is which
                  problems came back, not the numbers.
                </>
              }
              confirmLabel="Run it again"
              variant="primary"
              pending={start.isPending}
              onConfirm={() => {
                start.mutate();
              }}
            >
              <Button variant="primary" disabled={busy} pending={start.isPending}>
                Run it again
              </Button>
            </ConfirmButton>
          )}
        </Inline>

        {/* What failed, in the machine's own words, beside the control that failed (§7.4). */}
        {error === null ? null : <FieldError id={errorId}>{error.message}</FieldError>}
      </Stack>
    );
  },
);
