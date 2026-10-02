import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { isMissing, openProjectEventStream } from "./api.js";
import { q, staleAfter } from "./queries.js";
import { rehomed, rehomedStudyPath } from "./rehomed.js";
import { ProjectProvider, StudyProvider, useProject, useStudy } from "./context.jsx";
import { ProjectRail } from "./ProjectRail.jsx";
import {
  AppShell,
  Button,
  CenteredPage,
  DocumentPage,
  Link,
  PageHeader,
  Stack,
  StateBlock,
} from "./design/index.js";
import { Landing } from "./screens/Landing.jsx";
import { HowItWorks } from "./screens/HowItWorks.jsx";
import { Concepts } from "./screens/Concepts.jsx";
import { UseCases } from "./screens/UseCases.jsx";
import { WhyAgents } from "./screens/WhyAgents.jsx";
import { NotFound } from "./screens/NotFound.jsx";
import { Projects } from "./screens/Projects.jsx";
import { ProjectHome } from "./screens/ProjectHome.jsx";
import { StudyBuilder } from "./screens/StudyBuilder.jsx";
import { StudyPeople } from "./screens/StudyPeople.jsx";
import { StudyResults } from "./screens/StudyResults.jsx";
import { Preflight } from "./screens/Preflight.jsx";
import { Targets } from "./screens/library/Targets.jsx";
import { Target } from "./screens/library/Target.jsx";
import { ConnectTarget } from "./screens/library/ConnectTarget.jsx";
import { Personas } from "./screens/library/Personas.jsx";
import { PersonaBuilder } from "./screens/library/PersonaBuilder.jsx";
import { Cohorts } from "./screens/library/Cohorts.jsx";
import { CohortBuilder } from "./screens/library/CohortBuilder.jsx";
import { Populations } from "./screens/library/Populations.jsx";
import { PopulationBuilder } from "./screens/library/PopulationBuilder.jsx";
import { Settings } from "./screens/Settings.jsx";
import { FindingInFull } from "./screens/FindingInFull.jsx";
import { PeopleWhoHit } from "./screens/PeopleWhoHit.jsx";
import { Gaps } from "./screens/Gaps.jsx";
import { WhoLeft } from "./screens/WhoLeft.jsx";
import { RunCohorts } from "./screens/RunCohorts.jsx";
import { Executions } from "./screens/Executions.jsx";
import { ExecutionDigest } from "./screens/ExecutionDigest.jsx";
import { Compare } from "./screens/Compare.jsx";
import { PersonAcrossProject, PersonInStudy } from "./screens/Person.jsx";
import { Visits } from "./screens/Visits.jsx";
import { WatchAVisit } from "./screens/WatchAVisit.jsx";
import { LiveRun } from "./screens/LiveRun.jsx";

/**
 * The last project this browser had open, so `/app` lands where the reader left off (SPEC §7.3).
 *
 * It used to be `/` that did this. `/` is the public landing page now (ATOMIC-INVENTORY §6.3 row
 * 26), and the redirect moved wholesale to `/app` — the storage key, the fallback order and the
 * two `try`/`catch`es are the behaviour this app has always had and none of it changed.
 */
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

/**
 * The app's frame. `AppShell` (ATOMIC-INVENTORY §4, template 1) owns the skip link, the `<main>`
 * landmark, the route announcer, the toast region, the tooltip provider and the rail→drawer
 * switch. It fetches nothing, so the rail is composed here, where the data layer lives, and
 * handed over as a prop.
 *
 * The shell deliberately carries no gutter and no cap: `DocumentPage`, `InstrumentPage` and their
 * siblings own the page frame, and the old `max-w-[1100px] px-10 py-9` wrapper that used to live
 * here would halve every measure and double every gutter under them.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return <AppShell rail={<ProjectRail />}>{children}</AppShell>;
}

/**
 * A shell that could not read the record every screen under it hangs off. Railless, because the
 * rail is built out of the very thing that failed, and through `CenteredPage` because §4's
 * template table names the shells' own error states as one of its three uses.
 */
function ShellState({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <CenteredPage>{children}</CenteredPage>
    </AppShell>
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
      <ShellState>
        <StateBlock kind="loading" what="this project" />
      </ShellState>
    );
  if (project.isError)
    return (
      <ShellState>
        {isMissing(project.error) ? (
          <StateBlock kind="gone" what="this project">
            <Stack gap={6} align="start">
              <div>There is no project called {proj}. It may have been renamed, or deleted.</div>
              <Button asChild variant="primary">
                <RouterLink to="/projects">See the projects there are</RouterLink>
              </Button>
            </Stack>
          </StateBlock>
        ) : (
          // A read that failed is the one state a reader can act on, and the act is the same
          // everywhere or it is not learnable (§6.5, rule 7). It retries the read and promises
          // nothing about the answer.
          <StateBlock kind="failed" what="this project" error={project.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void project.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        )}
      </ShellState>
    );

  return (
    <ProjectProvider value={{ key: proj, project: project.data, href: (path) => `/p/${encodeURIComponent(proj)}${path === undefined ? "" : `/${path}`}` }}>
      <Frame>
        <Routes>
          {/* The studies dashboard IS the project's home: what has been sent where, and what
              needs doing before anything more can be (ADR-0043). */}
          <Route index element={<ProjectHome />} />
          {/*
            The study builder, and the study shell. `new` comes BEFORE `:study/*` so that it is a
            verb rather than a study's slug — the server reserves the slug for the same reason.
            One builder serves both modes: at `studies/new` it has no `:study` param, and at
            `studies/:study/edit` (inside the shell, below) it has one.
          */}
          <Route path="studies/new" element={<StudyBuilder />} />
          <Route path="studies/:study/*" element={<StudyShell />} />
          {/*
            `/studies` on its own is the dashboard, which is the index. `..` and not `.`: in
            react-router v7 a relative `to` resolves against the FULL matched path of the leaf
            route, so `.` from here would be `/p/:proj/studies` again, and `..` is the parent
            route — this shell — which is the index.
          */}
          <Route path="studies" element={<Navigate to=".." replace />} />
          {/*
            The address a study used to have. `s/` was in the product's URL bar and a bookmark is
            a promise (ADR-0042); every shape of it lands on its `studies/` twin, `replace`d so
            Back does not bounce off the redirect. The two that carry a parameter are components,
            because `<Navigate>` cannot interpolate one.
          */}
          <Route path="s" element={<Navigate to=".." replace />} />
          <Route path="s/new" element={<RehomedNewStudy />} />
          <Route path="s/:sim/*" element={<RehomedStudy />} />
          {/*
            The library, in the order the mental model runs: the addresses the product answers on,
            the kinds of person, the groups cut from them, the casts made of those groups. Every
            segment is a BARE PLURAL — the noun does not inflect on how many there are, because a
            label that changes with the data cannot be learned, searched for or read without
            flicker. The count lives in the rail's trailing figure.

            Every noun has a list and ONE builder serving `new` and `:id` (ADR-0043), and `new`
            is declared before `:id` everywhere so that it is a verb rather than an id.
          */}
          <Route path="library/targets" element={<Targets />} />
          {/*
            Connecting is its own flow, and it is the one builder that saves on the first
            successful check rather than at the end (ADR-0040; ADR-0043 records the exception):
            every identity field depends on a tool list nobody has seen before connecting.
          */}
          <Route path="library/targets/new" element={<ConnectTarget />} />
          <Route path="library/targets/:t" element={<Target />} />
          <Route path="library/personas" element={<Personas />} />
          <Route path="library/personas/new" element={<PersonaBuilder />} />
          <Route path="library/personas/:x" element={<PersonaBuilder />} />
          <Route path="library/cohorts" element={<Cohorts />} />
          <Route path="library/cohorts/new" element={<CohortBuilder />} />
          <Route path="library/cohorts/:c" element={<CohortBuilder />} />
          <Route path="library/populations" element={<Populations />} />
          <Route path="library/populations/new" element={<PopulationBuilder />} />
          <Route path="library/populations/:pop" element={<PopulationBuilder />} />
          {/*
            The singular addresses these moved off, kept as redirects because they have been in
            the product's URL bar and a bookmark is a promise. `replace`, so Back does not bounce
            off the redirect and land where the reader just came from.
          */}
          <Route path="library/target" element={<Navigate to="../library/targets" replace />} />
          <Route path="library/target/:t" element={<RehomedTarget />} />
          <Route path="library/people" element={<Navigate to="../library/cohorts" replace />} />
          <Route path="library/people/:cohortSlug" element={<RehomedCohort />} />
          {/* One person, across every study they have ever been in (SPEC §7.3). */}
          <Route path="people/:personId" element={<PersonAcrossProject />} />
          <Route path="settings" element={<Settings />} />
          {/* Inside a project an unknown path is a path into THIS project, so it lands on the
              project rather than on the product's 404 — which mounts its own shell, and a shell
              inside a shell is two skip links, two `<main>`s and two toast regions. `..` is this
              shell's own path (see the `studies` redirect above for why not `.`). */}
          <Route path="*" element={<Navigate to=".." replace />} />
        </Routes>
      </Frame>
    </ProjectProvider>
  );
}

/**
 * The two library redirects that carry a parameter. `<Navigate>` cannot interpolate one, so the
 * param is read and re-encoded here; `replace` keeps the old address out of the history.
 */
function RehomedTarget() {
  const { t = "" } = useParams();
  return <Navigate to={`../library/targets/${encodeURIComponent(t)}`} replace />;
}

function RehomedCohort() {
  const { cohortSlug = "" } = useParams();
  return <Navigate to={`../library/cohorts/${encodeURIComponent(cohortSlug)}`} replace />;
}

/**
 * `/p/:proj/s/new` → `/p/:proj/studies/new`, keeping the query string: the old address could
 * carry `?target=&population=` to seed the form, and the builder still reads them.
 */
function RehomedNewStudy() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "../studies/new", search }} replace />;
}

/**
 * `/p/:proj/s/:sim/anything` → `/p/:proj/studies/:sim/anything`. The path itself is
 * `rehomedStudyPath`, in `rehomed.ts`, so the promise a bookmark makes is testable without
 * mounting the router; the search and the hash travel because `#problems`-style anchors and
 * `?a=&b=` comparisons are part of what was bookmarked.
 */
function RehomedStudy() {
  const { sim = "", "*": rest = "" } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: rehomedStudyPath(sim, rest), search, hash }} replace />;
}

/**
 * The study shell. `runId` leaves the URL here: the study is the durable thing, and the execution
 * the results screens read is whichever one it last ran (SPEC §7.3). A study that has never run
 * still opens on its results, which say so and offer the pre-flight — the zero state is a state
 * of this screen, not a different screen.
 */
function StudyShell() {
  const { study: studyKey = "" } = useParams();
  const { key, href } = useProject();
  const summary = useQuery({ ...q.study(key, studyKey), enabled: studyKey !== "" });

  if (summary.isPending)
    return (
      <CenteredPage>
        <StateBlock kind="loading" what="this study" />
      </CenteredPage>
    );
  if (summary.isError)
    return (
      <CenteredPage>
        {isMissing(summary.error) ? (
          <StateBlock kind="gone" what="this study">
            <Stack gap={6} align="start">
              <div>This project has no study called {studyKey}. It may have been renamed, or deleted.</div>
              <Button asChild variant="primary">
                <RouterLink to={href()}>Back to the studies</RouterLink>
              </Button>
            </Stack>
          </StateBlock>
        ) : (
          <StateBlock kind="failed" what="this study" error={summary.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void summary.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        )}
      </CenteredPage>
    );

  const study = summary.data;
  const runId = study.latest?.runId ?? null;
  const base = `${href()}/studies/${encodeURIComponent(studyKey)}`;

  return (
    <StudyProvider value={{ key: studyKey, study, href: (path) => `${base}${path === undefined ? "" : `/${path}`}`, runId }}>
      <Routes>
        {/* The default view of a study is its RESULTS. A study is not a hub you pass through on
            the way to a run: it IS its latest findings, and a study that has never been sent says
            so on the same screen rather than on a different one. */}
        <Route index element={<StudyResults />} />
        <Route path="preflight" element={<Preflight />} />
        {/*
          What this study IS — its name, its target, its population, its size, its mode — in the
          same builder that made it (ADR-0043). It replaces the settings screen a study used to
          have, whose address is kept as a redirect below because it has been in the URL bar.
        */}
        <Route path="edit" element={<StudyBuilder />} />
        <Route path="settings" element={<Navigate to="../edit" replace />} />
        {/*
          The people this study sends (ADR-0041). They are numbered on the cohort and shared by
          every study that sends it, but which of them are IN is this study's size dealt through
          its population's weights, so they are read and written from here and nowhere else.
        */}
        <Route path="people" element={<StudyPeople />} />
        <Route path="f/:signature" element={<FindingInFull />} />
        <Route path="f/:signature/people" element={<PeopleWhoHit />} />
        <Route path="coverage" element={<Gaps />} />
        <Route path="executions" element={<Executions />} />
        <Route path="executions/compare" element={<Compare />} />
        {/*
          One execution's digest, which until now only `populace digest` could produce. It names
          its execution in the path rather than reading "the latest" out of context, because the
          reason to want one is usually an execution that is NOT the latest — the one that was
          stopped halfway. The screen reads it plainly; the verifier behind `?verify=true` is a
          press on that screen and never a consequence of arriving at this address.
        */}
        <Route path="executions/:runId/digest" element={<ExecutionDigest />} />
        {/*
          Who went in ONE execution, by cohort, with what they found. It names its execution for
          the same reason the digest does, and it is where the per-study "Population" screen
          moved when the people got a page of their own: the cast of an execution is a fact about
          that execution, frozen in its snapshot, and not about the study as it stands today.
        */}
        <Route path="executions/:runId/cohorts" element={<ExecutionCohorts />} />
        <Route path="population" element={<Navigate to="../people" replace />} />
        {/* Everything below reads ONE execution, so it needs one to exist. */}
        <Route path="live" element={<NeedsExecution runId={runId} title="Live">{(id) => <LiveRun runId={id} />}</NeedsExecution>} />
        <Route path="left" element={<NeedsExecution runId={runId} title="Who walked away">{(id) => <WhoLeft runId={id} />}</NeedsExecution>} />
        <Route path="visits" element={<NeedsExecution runId={runId} title="Visits">{(id) => <Visits runId={id} />}</NeedsExecution>} />
        {/* Not wrapped: a visit names itself, and the execution it belongs to is on the row. That
            is what lets a quote on a problem the latest execution did not report open the visit it
            actually happened in. */}
        <Route path="visits/:visitId" element={<WatchAVisit />} />
        <Route path="people/:pid" element={<NeedsExecution runId={runId} title="One person">{() => <PersonInStudy />}</NeedsExecution>} />
        {/* An unknown path under a study lands on the study. `..` is this shell's own path. */}
        <Route path="*" element={<Navigate to=".." replace />} />
      </Routes>
    </StudyProvider>
  );
}

/**
 * `RunCohorts` reads one execution and takes its id as a prop, as the other execution-scoped
 * screens do. At `executions/:runId/cohorts` the id is in the path rather than in the study's
 * `latest`, so this reads it out and hands it over.
 */
function ExecutionCohorts() {
  const { runId = "" } = useParams();
  return <RunCohorts runId={runId} />;
}

/**
 * A screen that reads one execution, on a study that has not had one. This is the common state,
 * not an error: a study exists before anybody is sent, and the answer is a sentence and the way
 * forward rather than a redirect that loses where the reader was going.
 *
 * It is a `StateBlock` preset that keeps the screen's own title (ATOMIC-INVENTORY §5), so the
 * reader is never on a page whose only clue to where they are is which item in the rail is lit.
 */
function NeedsExecution({ runId, title, children }: { runId: string | null; title: string; children: (runId: string) => React.ReactNode }) {
  const { href } = useStudy();
  if (runId !== null) return <>{children(runId)}</>;
  return (
    <DocumentPage
      header={<PageHeader title={title} lede="Nobody has been sent yet, so there is nothing here to read." />}
      state="empty"
      empty={
        <StateBlock kind="empty" what="this study">
          Nobody has visited the target under this study yet.{" "}
          {/* Absolute, from the study: a relative link here resolves against whichever screen
              the reader asked for, which put the pre-flight under `/visits/preflight`. */}
          <Link to={href("preflight")} size="ui">
            See who would go, and what it would cost
          </Link>
        </StateBlock>
      }
    >
      {null}
    </DocumentPage>
  );
}

/**
 * A bookmarked `/runs/:id` still works: it resolves to the study that owns the execution and
 * redirects into it, keeping whatever the reader was looking at (SPEC §7.3).
 */
function RunRedirect() {
  const { runId = "" } = useParams();
  const location = useLocation();
  const run = useQuery({ ...q.run(runId), enabled: runId !== "" });

  if (run.isPending)
    return (
      <ShellState>
        <StateBlock kind="loading" what="that execution" />
      </ShellState>
    );
  if (run.isError)
    return (
      <ShellState>
        {isMissing(run.error) ? (
          <StateBlock kind="gone" what="that execution">
            <Stack gap={6} align="start">
              <div>
                There is no execution {runId}. A swept execution keeps its findings and loses its
                rows.
              </div>
              {/*
                `/` is the public landing page now, so "back" means back into the product rather
                than out of it: `/app` is the project this browser last had open (§6.3 row 26).
              */}
              <Button asChild variant="primary">
                <RouterLink to="/app">Back to where you were</RouterLink>
              </Button>
            </Stack>
          </StateBlock>
        ) : (
          <StateBlock kind="failed" what="that execution" error={run.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void run.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        )}
      </ShellState>
    );
  if (run.data.projectId === "" || run.data.studyId === "") return <Navigate to="/app" replace />;

  const rest = location.pathname.split("/").slice(3).filter(Boolean);
  const first = rest[0];
  const head = first === undefined ? null : rehomed(first, run.data.id);
  const segments = head === null ? rest : head.length === 0 ? [] : [...head, ...rest.slice(1)];
  const tail = segments.map(encodeURIComponent).join("/");
  return <Navigate to={`/p/${encodeURIComponent(run.data.projectId)}/studies/${encodeURIComponent(run.data.studyId)}${tail ? `/${tail}` : ""}`} replace />;
}

/**
 * `/app` is the way in: the project you were last in, and a first visit is the project every
 * install has. This is the behaviour `/` carried before the landing page took that address —
 * the storage lookup, the fallback to the first project and the fallback to `/projects` are
 * unchanged, line for line.
 */
function AppEntry() {
  const projects = useQuery(q.projects());
  if (projects.isPending)
    return (
      <ShellState>
        <StateBlock kind="loading" what="your projects" />
      </ShellState>
    );
  if (projects.isError)
    return (
      <ShellState>
        <StateBlock kind="failed" what="your projects" error={projects.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void projects.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      </ShellState>
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
        {/* ---- THE PUBLIC PAGES -------------------------------------------------------
            Five routes, for everyone, and the only five in this table that read nothing. Each
            brings its own `MarketingShell`: the window scrolls there rather than a pane, there is
            no project to resolve, no query to fire and no rail to compose — which is why they sit
            here beside `/` rather than under a shell that would have to be told not to fetch.

            They are the brand surfaces, and the one place the approved messaging's word "agents"
            is allowed to appear (`/why-agents`, recorded as debt in ADR-0042). It stops at these
            five files: nothing shared with a product screen may carry it. */}
        <Route path="/" element={<Landing />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/concepts" element={<Concepts />} />
        <Route path="/use-cases" element={<UseCases />} />
        <Route path="/why-agents" element={<WhyAgents />} />
        <Route path="/app" element={<AppEntry />} />
        <Route
          path="/projects"
          element={
            // Railless: there is nothing to navigate to until you are inside a project. It is
            // still the shell, so the skip link, the landmark and the theme toggle are where
            // they are on every other screen.
            <AppShell>
              <Projects />
            </AppShell>
          }
        />
        <Route path="/runs/:runId/*" element={<RunRedirect />} />
        <Route path="/p/:proj/*" element={<ProjectShell />} />
        {/* An address that is not a route says so, and quotes what it was handed, instead of
            silently becoming the home page. `NotFound` mounts its own railless shell. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
