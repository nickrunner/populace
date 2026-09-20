import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { isMissing, openProjectEventStream } from "./api.js";
import { q, staleAfter } from "./queries.js";
import { ProjectProvider, SimulationProvider, useProject, useSimulation } from "./context.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Failed, Gone, Loading, PageHeader } from "./components/ui.jsx";
import { Projects } from "./screens/Projects.jsx";
import { ProjectHome } from "./screens/ProjectHome.jsx";
import { NewSimulation } from "./screens/NewSimulation.jsx";
import { Preflight } from "./screens/Preflight.jsx";
import { Targets } from "./screens/library/Targets.jsx";
import { Target } from "./screens/library/Target.jsx";
import { Personas } from "./screens/library/Personas.jsx";
import { PersonaEditor } from "./screens/library/PersonaEditor.jsx";
import { People } from "./screens/library/People.jsx";
import { Cohort } from "./screens/library/Cohort.jsx";
import { Settings } from "./screens/Settings.jsx";
import { SimulationResults } from "./screens/SimulationResults.jsx";
import { FindingInFull } from "./screens/FindingInFull.jsx";
import { PeopleWhoHit } from "./screens/PeopleWhoHit.jsx";
import { Gaps } from "./screens/Gaps.jsx";
import { WhoLeft } from "./screens/WhoLeft.jsx";
import { RunCohorts } from "./screens/RunCohorts.jsx";
import { Executions } from "./screens/Executions.jsx";
import { Compare } from "./screens/Compare.jsx";
import { PersonAcrossProject, PersonInSimulation } from "./screens/Person.jsx";
import { Visits } from "./screens/Visits.jsx";
import { WatchAVisit } from "./screens/WatchAVisit.jsx";
import { LiveRun } from "./screens/LiveRun.jsx";

/** The last project this browser had open, so `/` lands where the reader left off (SPEC §7.3). */
const LAST = "populace:last-project";

function remember(key: string): void {
  try {
    window.localStorage.setItem(LAST, key);
  } catch {
    // A browser with storage turned off still works; it just always opens on the first project.
  }
}

function lastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1100px] px-10 py-9">{children}</div>
      </main>
    </div>
  );
}

/**
 * The project shell. It resolves `:proj` once — a slug or an id, whichever is in the URL — puts
 * it in context, and opens ONE event stream for the whole project, which is what replaces the
 * global five-second poll every query used to carry (ADR-0026).
 */
function ProjectShell() {
  const { proj = "" } = useParams();
  const queries = useQueryClient();
  const project = useQuery({ ...q.project(proj), enabled: proj !== "" });
  const projectId = project.data?.id;

  useEffect(() => {
    if (proj !== "") remember(proj);
  }, [proj]);

  useEffect(() => {
    if (projectId === undefined) return;
    return openProjectEventStream(projectId, (event) => {
      for (const key of staleAfter(event)) void queries.invalidateQueries({ queryKey: key });
    });
  }, [projectId, queries]);

  if (project.isPending)
    return (
      <div className="p-10">
        <Loading what="this project" />
      </div>
    );
  if (project.isError)
    return (
      <div className="p-10">
        {isMissing(project.error) ? (
          <Gone what={`There is no project called ${proj}.`}>
            <Link to="/projects" className="text-accent hover:underline">
              See the projects there are
            </Link>
          </Gone>
        ) : (
          <Failed error={project.error} />
        )}
      </div>
    );

  return (
    <ProjectProvider value={{ key: proj, project: project.data, href: (path) => `/p/${encodeURIComponent(proj)}${path === undefined ? "" : `/${path}`}` }}>
      <Frame>
        <Routes>
          <Route index element={<ProjectHome />} />
          <Route path="s/new" element={<NewSimulation />} />
          <Route path="s/:sim/*" element={<SimulationShell />} />
          <Route path="library/target" element={<Targets />} />
          <Route path="library/target/:t" element={<Target />} />
          <Route path="library/personas" element={<Personas />} />
          <Route path="library/personas/:x" element={<PersonaEditor />} />
          <Route path="library/people" element={<People />} />
          <Route path="library/people/:cohortSlug" element={<Cohort />} />
          {/* One person, across every simulation they have ever been in (SPEC §7.3). */}
          <Route path="people/:personId" element={<PersonAcrossProject />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </Frame>
    </ProjectProvider>
  );
}

/**
 * The simulation shell. `runId` leaves the URL here: the simulation is the durable thing, and the
 * execution the results screens read is whichever one it last ran (SPEC §7.3). A simulation that
 * has never run still opens on its results, which say so and offer the pre-flight — the zero
 * state is a state of this screen, not a different screen.
 */
function SimulationShell() {
  const { sim = "" } = useParams();
  const { key, href } = useProject();
  const summary = useQuery({ ...q.simulation(key, sim), enabled: sim !== "" });

  if (summary.isPending) return <Loading what="this simulation" />;
  if (summary.isError)
    return isMissing(summary.error) ? (
      <Gone what={`This project has no simulation called ${sim}. It may have been renamed, or deleted.`}>
        <Link to={href()} className="text-accent hover:underline">
          Back to the simulations
        </Link>
      </Gone>
    ) : (
      <Failed error={summary.error} />
    );

  const simulation = summary.data;
  const runId = simulation.latest?.runId ?? null;
  const base = `${href()}/s/${encodeURIComponent(sim)}`;

  return (
    <SimulationProvider value={{ key: sim, simulation, href: (path) => `${base}${path === undefined ? "" : `/${path}`}`, runId }}>
      <Routes>
        {/* The default view of a simulation is its RESULTS. A simulation is not a hub you pass
            through on the way to a run: it IS its latest findings, and a simulation that has
            never been sent says so on the same screen rather than on a different one. */}
        <Route index element={<SimulationResults />} />
        <Route path="preflight" element={<Preflight />} />
        <Route path="f/:signature" element={<FindingInFull />} />
        <Route path="f/:signature/people" element={<PeopleWhoHit />} />
        <Route path="coverage" element={<Gaps />} />
        <Route path="executions" element={<Executions />} />
        <Route path="executions/compare" element={<Compare />} />
        {/* Everything below reads ONE execution, so it needs one to exist. */}
        <Route path="live" element={<NeedsExecution runId={runId} title="Live">{(id) => <LiveRun runId={id} />}</NeedsExecution>} />
        <Route path="left" element={<NeedsExecution runId={runId} title="Who walked away">{(id) => <WhoLeft runId={id} />}</NeedsExecution>} />
        <Route path="population" element={<NeedsExecution runId={runId} title="Population">{(id) => <RunCohorts runId={id} />}</NeedsExecution>} />
        <Route path="visits" element={<NeedsExecution runId={runId} title="Visits">{(id) => <Visits runId={id} />}</NeedsExecution>} />
        {/* Not wrapped: a visit names itself, and the execution it belongs to is on the row. That
            is what lets a quote on a problem the latest execution did not report open the visit it
            actually happened in. */}
        <Route path="visits/:wakeId" element={<WatchAVisit />} />
        <Route path="people/:pid" element={<NeedsExecution runId={runId} title="One person">{() => <PersonInSimulation />}</NeedsExecution>} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </SimulationProvider>
  );
}

/**
 * A screen that reads one execution, on a simulation that has not had one. This is the common
 * state, not an error: a simulation exists before anybody is sent, and the answer is a sentence
 * and the way forward rather than a redirect that loses where the reader was going.
 */
function NeedsExecution({ runId, title, children }: { runId: string | null; title: string; children: (runId: string) => React.ReactNode }) {
  const { href } = useSimulation();
  if (runId !== null) return <>{children(runId)}</>;
  return (
    <div>
      {/* The screen keeps its name while it is empty. Without it the reader is on a page whose
          only clue to where they are is which item in the rail is lit. */}
      <PageHeader title={title} lede="Nobody has been sent yet, so there is nothing here to read." />
      {/* Absolute, from the simulation: a relative link here resolves against whichever screen
          the reader asked for, which put the pre-flight under `/population/preflight`. */}
      <Link to={href("preflight")} className="t-body text-accent hover:underline">
        See who would go, and what it would cost
      </Link>
    </div>
  );
}

/**
 * A bookmarked `/runs/:id` still works: it resolves to the simulation that owns the execution and
 * redirects into it, keeping whatever the reader was looking at (SPEC §7.3).
 */
const REHOMED: Record<string, string> = { gaps: "coverage", wakes: "visits", agents: "population", findings: "" };

function RunRedirect() {
  const { runId = "" } = useParams();
  const location = useLocation();
  const run = useQuery({ ...q.run(runId), enabled: runId !== "" });

  if (run.isPending) return <Loading what="that run" />;
  if (run.isError)
    return (
      <div className="p-10">
        {isMissing(run.error) ? (
          <Gone what={`There is no execution ${runId}. A swept execution keeps its findings and loses its rows.`}>
            <Link to="/" className="text-accent hover:underline">
              Back to where you were
            </Link>
          </Gone>
        ) : (
          <Failed error={run.error} />
        )}
      </div>
    );
  if (run.data.projectId === "" || run.data.simulationId === "") return <Navigate to="/" replace />;

  const rest = location.pathname.split("/").slice(3).filter(Boolean);
  const head = rest[0] === undefined ? undefined : (REHOMED[rest[0]] ?? rest[0]);
  // `findings` maps to nothing: a cluster used to be identified by its place in one execution's
  // digest and is identified by its signature now, so an old link to one can only land on the
  // results screen that lists them all (ADR-0028).
  const tail = head === "" ? "" : [...(head === undefined ? [] : [head]), ...rest.slice(1)].map(encodeURIComponent).join("/");
  return <Navigate to={`/p/${encodeURIComponent(run.data.projectId)}/s/${encodeURIComponent(run.data.simulationId)}${tail ? `/${tail}` : ""}`} replace />;
}

/** `/` is the project you were last in, and a first visit is the project every install has. */
function Landing() {
  const projects = useQuery(q.projects());
  if (projects.isPending)
    return (
      <div className="p-10">
        <Loading what="your projects" />
      </div>
    );
  if (projects.isError)
    return (
      <div className="p-10">
        <Failed error={projects.error} />
      </div>
    );

  const items = projects.data.items;
  const last = lastProject();
  const remembered = last === null ? undefined : items.find((p) => p.slug === last || p.id === last);
  const open = remembered ?? items[0];
  return open ? <Navigate to={`/p/${encodeURIComponent(open.slug)}`} replace /> : <Navigate to="/projects" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/runs/:runId/*" element={<RunRedirect />} />
        <Route path="/p/:proj/*" element={<ProjectShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
