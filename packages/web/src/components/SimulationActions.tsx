import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type SimulationSummary } from "../api.js";
import { useProject } from "../context.jsx";
import { Button } from "./ui.jsx";

/**
 * The one action a simulation is asking for, in the words its mode makes true (SPEC §4.1).
 *
 * Ephemeral and longitudinal differ here and nowhere else in the controls: an ephemeral execution
 * is bounded, so it is stopped and then run again as a sibling; a longitudinal one is a life, so
 * it is paused and picked back up on the same run id. "Run it again" is deliberately not offered
 * for a longitudinal simulation — starting over would throw away the history that is the whole
 * reason it is longitudinal.
 */
export function SimulationActions({ simulation, live = false }: { simulation: SimulationSummary; live?: boolean }) {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const base = `${href()}/s/${encodeURIComponent(simulation.slug)}`;
  const runId = simulation.latest?.runId ?? "";

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

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {simulation.status === "never-run" ? (
          <>
            {live ? null : (
              <Link to={`${base}/preflight`} className="t-body px-3 py-1.5 rounded-md border border-rule text-ink-soft hover:bg-well">
                Before you send them
              </Link>
            )}
            <Button tone="go" onClick={() => start.mutate()} disabled={busy}>
              {start.isPending ? "Starting…" : "Send them in"}
            </Button>
          </>
        ) : simulation.status === "running" ? (
          simulation.mode === "longitudinal" ? (
            <Button onClick={() => pause.mutate()} disabled={busy}>
              Pause
            </Button>
          ) : (
            <Button onClick={() => stop.mutate()} disabled={busy}>
              Let them finish, then stop
            </Button>
          )
        ) : simulation.status === "paused" ? (
          <Button tone="go" onClick={() => resume.mutate()} disabled={busy}>
            Pick it back up
          </Button>
        ) : simulation.mode === "longitudinal" ? (
          <Button tone="go" onClick={() => start.mutate()} disabled={busy}>
            {start.isPending ? "Starting…" : "Start a new one"}
          </Button>
        ) : (
          <Button tone="go" onClick={() => start.mutate()} disabled={busy}>
            {start.isPending ? "Starting…" : "Run it again"}
          </Button>
        )}
      </div>
      {error ? <p className="t-meta text-critical">{error.message}</p> : null}
    </div>
  );
}
