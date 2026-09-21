import { createContext, useContext, type ReactNode } from "react";
import type { ProjectOverview, SimulationSummary } from "./api.js";

/**
 * The project and the simulation are read from the URL and put in context, not threaded through
 * every screen as props. `App.tsx` used to hand `runId` down to nine screens, which is why every
 * one of them had to know a run existed before it could render a heading — and why the run id was
 * in the URL at all. The simulation is what a user bookmarks; which execution it last ran is a
 * detail of the page (SPEC §7.3).
 */

export interface ProjectScope {
  /** The URL segment, exactly as it was written: a slug or an id, and never re-spelled. */
  key: string;
  project: ProjectOverview;
  /** `/p/my-app`, or `/p/my-app/library/people` with a path. */
  href: (path?: string) => string;
}

const Project = createContext<ProjectScope | null>(null);

export function ProjectProvider({ value, children }: { value: ProjectScope; children: ReactNode }) {
  return <Project.Provider value={value}>{children}</Project.Provider>;
}

export function useProject(): ProjectScope {
  const scope = useContext(Project);
  if (scope === null) throw new Error("this screen is outside a project");
  return scope;
}

export interface SimulationScope {
  key: string;
  simulation: SimulationSummary;
  /** `/p/my-app/s/smoke`, or with a path under it. */
  href: (path?: string) => string;
  /**
   * The execution the run-scoped screens read. Null before the simulation has ever been run,
   * which is the common case and not an error: it is what the zero state is for.
   */
  runId: string | null;
}

const Simulation = createContext<SimulationScope | null>(null);

export function SimulationProvider({ value, children }: { value: SimulationScope; children: ReactNode }) {
  return <Simulation.Provider value={value}>{children}</Simulation.Provider>;
}

export function useSimulation(): SimulationScope {
  const scope = useContext(Simulation);
  if (scope === null) throw new Error("this screen is outside a simulation");
  return scope;
}
