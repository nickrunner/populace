import { createContext, useContext, type ReactNode } from "react";
import type { ProjectOverview, StudySummary } from "./api.js";

/**
 * The project and the study are read from the URL and put in context, not threaded through
 * every screen as props. `App.tsx` used to hand `runId` down to nine screens, which is why every
 * one of them had to know a run existed before it could render a heading — and why the run id was
 * in the URL at all. The study is what a user bookmarks; which execution it last ran is a detail
 * of the page (SPEC §7.3).
 */

export interface ProjectScope {
  /** The URL segment, exactly as it was written: a slug or an id, and never re-spelled. */
  key: string;
  project: ProjectOverview;
  /** `/p/my-app`, or `/p/my-app/library/cohorts` with a path. */
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

/**
 * A study, as the screens under `/p/:proj/studies/:study` read it (ADR-0042). The word is the
 * user's: the row underneath is still a `Simulation` and every store method still says so, but
 * nothing that reaches a screen from here does.
 */
export interface StudyScope {
  /** The URL segment, exactly as written: the study's slug or its id. */
  key: string;
  study: StudySummary;
  /** `/p/my-app/studies/smoke`, or with a path under it. */
  href: (path?: string) => string;
  /**
   * The execution the run-scoped screens read. Null before the study has ever been run, which
   * is the common case and not an error: it is what the zero state is for.
   */
  runId: string | null;
}

const Study = createContext<StudyScope | null>(null);

export function StudyProvider({ value, children }: { value: StudyScope; children: ReactNode }) {
  return <Study.Provider value={value}>{children}</Study.Provider>;
}

export function useStudy(): StudyScope {
  const scope = useContext(Study);
  if (scope === null) throw new Error("this screen is outside a study");
  return scope;
}
