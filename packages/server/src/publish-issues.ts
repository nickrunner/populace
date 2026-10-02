import type { ClusterCardView, ClusterDetailView, PublishIssueResult, PublishIssuesSummary, PublishSkipReason } from "@populace/contract";
import {
  FiledIssueSchema,
  SEVERITY_RANK,
  personIdOfAgentId,
  type Agent,
  type FiledIssue,
  type FiledIssueSighting,
  type Finding,
  type GithubConnection,
  type Job,
  type JsonValue,
  type Run,
  type Simulation,
  type Store,
  type ToolCallRecord,
  type Wake,
} from "@populace/core";
import { buildFixPrompt, fitIssueBody, issueTitleOf, people, plural, verdictWords } from "@populace/fix-prompt";
import type { SignatureHistory } from "@populace/reports";
import { GithubClient, type GithubFailure, type IssueRef } from "./github.js";
import type { ProjectReadModel, PublishableCluster } from "./project-read-model.js";
import { historiesOf, problemReach, reportWindows, type ProblemReach, type ReportWindow } from "./report-windows.js";

/**
 * Filing a study's problems into somebody's issue tracker: the one function behind all three
 * triggers — one problem from its own page, a bulk job over the results screen, and the automatic
 * report cycle. They differ in who asked and in what they do with the answer, not in what happens,
 * which is why there is one function and not three.
 *
 * Four things run through every line of this file.
 *
 * **1. It spends no model money and dials nobody's product.** The clusters come from the read
 * model with `NO_COVERAGE`, so no MCP session is opened to the target — an automatic file that woke
 * somebody's product is a surprise nobody asked for, and the coverage panel is the only thing on
 * the results screen that needs one. Nothing here verifies either: verification lives in the
 * digest, which the cycle enqueues first (ADR-0044).
 *
 * **2. The same problem is not filed twice, and the thing that makes that true is the member
 * signature SET.** A cluster's own `signature` is its clustering's representative, and
 * `pickRepresentative` sorts on verdict score first — so the digest writing a verdict moves it
 * inside one execution, with nobody having reworded anything. Every match here is set intersection
 * over `PublishableCluster.signatures` (`FiledIssueSchema` carries the argument in full), and the
 * second line of defence is a marker in the issue body that survives the local ledger being
 * dropped by a schema rebuild (ADR-0011). **And when that second line of defence cannot answer, it
 * refuses to create.** A marker search that was rate limited is not a marker search that found
 * nothing (`MarkerSearch`); read as one, a single 403 files a duplicate of every problem whose
 * ledger row is gone. A skipped issue can be filed by running the pass again; a duplicate in
 * somebody's public tracker cannot be taken back.
 *
 * **2b. Every number is counted over the same stretch of time as the sentence it sits under.**
 * `publishable` is scoped to the report WINDOW being published and not to the execution
 * (`ProjectReadModel.publishable`), the reach numbers and the quiet duration are counted over the
 * whole GROUP a ledger row has bridged (`Work.group`), and where a lifetime total is worth saying
 * it is said on its own line with its scope named (`incidenceLines`). A count that is right for a
 * different stretch than its sentence is a false claim and not a rounding error.
 *
 * **3. An absence is never a fix.** A problem that stopped being reported gets a comment saying so
 * as an absence, with the reach numbers that actually support it and the people who walked away
 * named separately, because their silence is not a judgement. The words "fixed", "verified",
 * "resolved" and "no longer reproducible" appear in nothing this file writes, and "fixed" is a
 * human's word typed on the triage control (`DESIGN-SYSTEM.md` §7.3). An issue is reopened when the
 * problem is reported again, and the comment that goes with it says what was observed and makes no
 * claim about why anybody closed it — populace cannot know that. **And an absence is NEWS rather
 * than a state, so it is said once**: a gone-quiet comment repeated on every report cycle for the
 * rest of a study's life is a hundred and seventy a week on the issues whose repairs just worked,
 * which turns the one comment this whole loop exists to deliver into the reason it is muted
 * (`comment`, `FiledIssueQuietNoticeSchema`).
 *
 * **4. It writes no triage row, ever.** Manufacturing a judgement nobody typed would make the
 * finding page say a human settled this minutes ago and hand `drifted` a `titleAtTriage` no human
 * stood behind. The filed issue reaches the screens through `ClusterCardView.filedIssue` and
 * `TriageView.filedIssue`, both read off the ledger.
 *
 * And one rule of vocabulary that binds harder here than anywhere else in the codebase: "agent",
 * "wake", "simulation" and "lane" appear in no title, body or comment (ADR-0032, ADR-0042). An
 * issue is the most public copy populace produces, and a title lands in a search index that
 * outlives the issue being edited or deleted.
 */

/** The only provider today, and a value rather than an assumption — see `FiledIssueSchema`. */
const PROVIDER = "github" as const;

/**
 * Refused before anything went out: there is nowhere to file, or nothing to file with.
 *
 * Its own class so a route can answer 409 and a job can record the sentence, the way
 * `ConfigIncomplete` and `StoreLocked` are told apart from a genuine failure. The message never
 * carries the token — there is nothing to say about a credential except whether one is stored.
 */
export class IssuesNotConnected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuesNotConnected";
  }
}

/**
 * The half of `GithubClient` this needs, typed off the class so the two cannot drift: adding an
 * operation there does not silently widen what a test double has to answer, and renaming one here
 * is a compile error rather than a runtime surprise.
 */
export type IssueClient = Pick<GithubClient, "ensureLabels" | "createIssue" | "getIssue" | "addComment" | "reopenIssue" | "searchIssues" | "outOfTime">;

export interface PublishIssuesDeps {
  store: Store;
  readModel: ProjectReadModel;
  /**
   * Built once per publish from the connection. Injected so a test answers offline: the real one
   * holds the token and talks to github.com, and nothing in the suite may do either.
   */
  client?: (connection: { repo: string; token: string }) => IssueClient;
  now?: () => Date;
  /** Called as each problem is dealt with, for the bulk job's progress row. */
  onProgress?: (done: number, total: number) => void;
}

export interface PublishIssuesOptions {
  simulation: Simulation;
  /**
   * Only these problems, by the signature the results screen shows. Absent means every one that
   * passes the connection's filter, which is what the automatic path sends — it has no reader to
   * tick boxes for it.
   *
   * Naming a signature says which problems to consider and never which rules to waive: every hard
   * skip still applies, and a name that is not among this study's results comes back `not-found`
   * rather than as an error, because a bulk job cannot answer 404.
   */
  signatures?: readonly string[];
}

/**
 * The marker that makes an issue findable without the local ledger.
 *
 * `populace` keeps the dedupe ledger in SQLite, and the store has no migration framework: a
 * `SCHEMA_SHAPE` change drops every table and rebuilds it (ADR-0011). Without something in the
 * issue itself, one schema change re-files every issue in somebody's repository. So every body
 * carries one of these per member signature, and a candidate that the ledger does not match is
 * searched for before anything is created.
 *
 * The signature is already the hash the plan asks a marker to carry — `signatureOf` is
 * `sha256(kind | tool | sorted title tokens)` — so this is that, not a second derivation of it.
 * The colon becomes a hyphen because the marker is searched for as a quoted phrase and GitHub
 * tokenises punctuation: one run of word characters and hyphens is the shape that comes back.
 */
export function markerFor(signature: string): string {
  return `populace-problem-${signature.replace(":", "-")}`;
}

/**
 * How many of a cluster's signatures get a marker in the body, and how many are searched for.
 *
 * The first bounds an invisible comment block nobody reads, so it is generous. The second is
 * deliberately small: search has a rate limit of its own and a limited search answers "nothing
 * found", which on a candidate with no ledger row means filing a second issue. Searching happens
 * only where the ledger did not match — a repeat pass searches for nothing at all — so the cost is
 * per genuinely new problem rather than per publish.
 */
const MARKERS_IN_BODY = 25;
const MARKERS_SEARCHED = 3;

/**
 * Whether the marker search can still be relied on for this pass.
 *
 * It is pass-level state and not per-problem for two reasons, and both are about a bulk pass over
 * forty new problems. Search is a rate-limited endpoint of its own — roughly thirty requests a
 * minute — and three markers per new problem is a hundred and twenty requests, so a pass that
 * keeps asking after the first refusal spends the rest of its wall clock being refused. And the
 * answer would not be usable anyway: once search is refusing, populace cannot tell "not filed" from
 * "not answered" for ANY of the problems behind it, so the honest thing is to stop asking and
 * refuse to create, once, with the reason GitHub gave for the first refusal.
 */
type SearchState = { state: "ready" } | { state: "unavailable"; failure: GithubFailure };

/** What a marker lookup answered: found, genuinely nothing found, or no answer at all. */
type MarkerLookup = { outcome: "found"; issue: IssueRef } | { outcome: "none" } | { outcome: "could-not-answer"; failure: GithubFailure };

/**
 * One publish at a time per project, as a chain of promises keyed by store and project.
 *
 * **Why this is needed although every write below is careful.** The comment on the synchronous
 * route claims the ledger read, the marker search and the per-issue ledger write are what stop a
 * click during a bulk job from filing the same problem twice, and they are not: the route runs
 * OUTSIDE the serial job queue on purpose, so two passes over one project interleave freely. Both
 * read the ledger before either writes a row, both then search for the same marker before either
 * creates, and both get "nothing found" — because at the moment each asked, nothing had been
 * filed. Two issues for one problem, in somebody's tracker, which is the one thing that must not
 * happen and cannot be taken back.
 *
 * Serialising per PROJECT and not globally, because the ledger, the connection and the marker
 * search are all per project (ADR-0035): two projects filing at once contend over nothing, and one
 * project's rate limit must not hold up another's press.
 *
 * It is keyed by the STORE as well, in a `WeakMap`, and that is not a nicety either. What is being
 * protected is one ledger, and a ledger is one `(store, project)` — a project id on its own is a
 * string that several unrelated stores use, so a map keyed on it alone makes two databases that
 * share nothing queue behind each other. In this process there is one store and the two readings
 * agree; in a test file there is one store per case, and one pass left in flight when a case ended
 * held up every later one. The weak key also means a store that goes away takes its queue with it.
 */
const publishing = new WeakMap<Store, Map<string, Promise<void>>>();

/**
 * Run `pass` after whatever is already queued for this project and store, and make sure the queue
 * survives it either way.
 *
 * The tail deliberately swallows the outcome. A rejected promise left in the map would be inherited
 * by every later publish for that project — one refused token would make the next press fail with
 * the last one's error for the life of the process — so the chain records only that the previous
 * pass finished, and the caller still gets the real promise with the real rejection.
 */
function serialised<T>(store: Store, projectId: string, pass: () => Promise<T>): Promise<T> {
  const queues = publishing.get(store) ?? new Map<string, Promise<void>>();
  publishing.set(store, queues);
  const previous = queues.get(projectId) ?? Promise.resolve();
  const result = previous.then(pass, pass);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(projectId, tail);
  // Dropped once it is the last one, so a long-lived server does not hold a settled promise per
  // project it has finished filing for.
  void tail.then(() => {
    if (queues.get(projectId) === tail) queues.delete(projectId);
  });
  return result;
}

/**
 * File a study's problems, and comment on the ones already filed.
 *
 * Returns what happened to every problem it considered, in the order it dealt with them. A failure
 * part way through is reported rather than thrown: the ledger row is written per issue before the
 * next one starts, so everything before the failure is already persisted and the caller's job is to
 * say so. The only throw is `IssuesNotConnected`, which happens before any outbound write.
 *
 * Passes over one project are serialised here rather than at any call site, because there are three
 * call sites and only one of them is a job (`serialised`).
 */
export function publishIssues(options: PublishIssuesOptions, deps: PublishIssuesDeps): Promise<PublishIssuesSummary> {
  return serialised(deps.store, options.simulation.projectId, () => publishPass(options, deps));
}

async function publishPass(options: PublishIssuesOptions, deps: PublishIssuesDeps): Promise<PublishIssuesSummary> {
  const { store, readModel } = deps;
  const { simulation } = options;
  const at = (): string => (deps.now?.() ?? new Date()).toISOString();

  const connection = await requireConnection(store, simulation.projectId);
  const client = (deps.client ?? ((c) => new GithubClient(c)))({ repo: connection.repo, token: connection.token });

  // The rows FIRST, because the report windows come out of them and the window is what every
  // cluster below is counted over. This is deliberately no longer one `Promise.all`: `publishable`
  // takes the window it is reporting on, and a publish that let it default to the whole execution
  // would count a longitudinal study's entire life — one execution for its whole life — as "the
  // latest report cycle" (see `ProjectReadModel.publishable`).
  //
  // Both reads are bounded by the study's executions and not by its problems: the shape this file
  // exists to avoid is `cluster()` per candidate, which rebuilds the whole study context — every
  // execution, every visit, every report and two clustering passes — each time.
  const rows = await studyRows(store, simulation);
  const windows = reportWindows(rows);
  // The window this publish is reporting on: the newest one anybody visited. A window nobody
  // visited is no evidence either way, and an execution created seconds ago and not yet under way
  // is the case where reading silence as an absence would be most wrong.
  const current = [...windows].reverse().find((window) => window.visited) ?? windows.at(-1);
  const problems = await readModel.publishable(simulation, current);

  const selected = select(problems, options.signatures);
  const ledger = await Promise.all(selected.map((problem) => store.matchFiledIssues(simulation.projectId, PROVIDER, connection.repo, problem.signatures)));

  // "These wordings are one problem", as an equivalence over signatures rather than as a map from
  // each signature to a winner. See `groupsOf`: the map this replaced was last-writer-wins, and two
  // selected clusters matching ONE ledger row had that row's signatures written twice.
  const grouping = groupsOf(selected, ledger);
  // Off the windows computed above rather than off the rows again: `windowHistories` would redo
  // every boundary, every visit and every report for a second time in one publish, and the two
  // passes could disagree if a row landed between them (finding 8).
  const histories = historiesOf(windows, grouping.keys);

  const results: PublishIssueResult[] = [];
  const named = options.signatures !== undefined;
  /** Issues this pass has already written to, so two candidates matching one row do not both comment. */
  const touched = new Set<number>();
  /** Lazily ensured, once, and only if something is actually going to be created. */
  let labels: LabelState = { state: "unasked" };
  /** Ready until a marker search refuses, after which no more are asked. See `SearchState`. */
  let search: SearchState = { state: "ready" };
  /** Every marker this pass has already asked about, so two problems sharing one never ask twice. */
  const asked = new Map<string, IssueRef | null>();
  /**
   * Candidates this pass has dealt with, by identity.
   *
   * Two names the caller gave can resolve to ONE cluster now that a name is matched against a
   * cluster's members (`select`), and dealing with the same candidate twice would file it twice:
   * the ledger was read for every candidate before the first one wrote its row, so the second
   * still sees no match. The set is by object identity because two DIFFERENT clusters bridged into
   * one group by a ledger row are two candidates and must both get their comment.
   */
  const handled = new Set<PublishableCluster>();

  for (const [index, problem] of selected.entries()) {
    const card = problem.card;
    const matched = ledger[index] ?? [];
    if (handled.has(problem)) {
      results.push(skipped(card.signature, "already-filed"));
      deps.onProgress?.(index + 1, selected.length);
      continue;
    }
    handled.add(problem);
    // The whole pass's wall clock, asked BETWEEN problems, where stopping is clean: everything
    // filed so far is filed and its ledger rows are written. Without it a pass that runs into a
    // rate limit grinds through the remaining problems getting refused on every request, which
    // costs a job slot for as long as the limit lasts and reports nothing anybody can act on. The
    // sentence is the client's own, because it is the one that knows what the budget was.
    const stop = client.outOfTime();
    if (stop !== null) {
      for (const remaining of selected.slice(index)) {
        results.push({ signature: remaining.card.signature, outcome: "failed", summary: stop.message, issue: null, reason: null, error: stop.message });
      }
      break;
    }
    const key = grouping.keyOf(card.signature);
    try {
      const outcome = await dealWith({
        problem,
        matched,
        named,
        connection,
        client,
        store,
        simulation,
        rows,
        windows,
        current,
        group: grouping.members.get(key) ?? new Set(problem.signatures),
        history: histories.get(key),
        touched,
        at,
        labels: () => labels,
        setLabels: (next) => {
          labels = next;
        },
        search: () => search,
        setSearch: (next) => {
          search = next;
        },
        asked,
      });
      results.push(outcome);
    } catch (err) {
      // Nothing in here is expected to throw — every GitHub operation answers with a typed outcome
      // — so this is the guard that keeps one unforeseen problem from losing the report of the
      // thirty before it. The message is the error's own and never a response body.
      results.push({
        signature: card.signature,
        outcome: "failed",
        summary: `populace could not finish this one: ${err instanceof Error ? err.message : String(err)}`,
        issue: null,
        reason: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    deps.onProgress?.(index + 1, selected.length);
  }

  return {
    repo: connection.repo,
    visibility: connection.visibility,
    filed: results.filter((r) => r.outcome === "filed").length,
    commented: results.filter((r) => r.outcome === "commented").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };
}

// ---- the connection --------------------------------------------------------

/** The connection, with a repository and a token, or a refusal a person can act on. */
async function requireConnection(store: Store, projectId: string): Promise<GithubConnection & { token: string }> {
  const connection = await store.getGithubConnection(projectId);
  if (connection === undefined || connection.repo === "") {
    throw new IssuesNotConnected("This project has no repository to file issues into. Add one in the project's settings, check it, and populace will file there.");
  }
  if (connection.token === undefined || connection.token === "") {
    // Says what is missing and nothing about what is stored. A credential goes up and never comes
    // back down, and that includes coming back down as a description of itself (ADR-0040).
    throw new IssuesNotConnected(`populace has ${connection.repo} to file into but no token to file with. Paste a token with write access to issues on that repository and press Check.`);
  }
  return { ...connection, token: connection.token };
}

// ---- what a study is, in rows ----------------------------------------------

interface StudyRows {
  runs: Run[];
  wakes: Wake[];
  findings: Finding[];
  jobs: Job[];
  agents: Agent[];
  /**
   * Every host the product under study answers on, MCP endpoints and web base alike, for the
   * public-repository address reduction (`withoutAddresses`).
   *
   * The web base is here because it is nowhere else: `ClusterDetailView.product.endpoints` carries
   * the MCP endpoints only, so a reduction that looked at the detail alone could not see the
   * address people actually opened pages at — and `fetch_page` means the transcript is full of it.
   * It went into world-readable repositories in full while the MCP endpoint three inches above it
   * had been carefully cut back to its host.
   */
  hosts: string[];
}

/**
 * Every row the report windows and the reach numbers are counted off, in a handful of reads.
 *
 * The per-execution loops are bounded by how many times somebody has run the study, which is the
 * one dimension a filing pass is allowed to grow a query count along — `listJobs` and `listAgents`
 * both take a single run, and neither has a cross-run form.
 */
async function studyRows(store: Store, simulation: Simulation): Promise<StudyRows> {
  const runs = (await store.listRuns({ simulationId: simulation.id })).sort((a, b) => a.seq - b.seq);
  const runIds = runs.map((run) => run.id);
  const [wakes, findings, jobs, agents, hosts] = await Promise.all([
    runIds.length === 0 ? Promise.resolve<Wake[]>([]) : store.listWakes({ runIds }),
    runIds.length === 0 ? Promise.resolve<Finding[]>([]) : store.listFindings({ runIds }),
    Promise.all(runs.map((run) => store.listJobs({ runId: run.id }))).then((lists) => lists.flat()),
    Promise.all(runs.map((run) => store.listAgents({ runId: run.id }))).then((lists) => lists.flat()),
    targetHosts(store, simulation, runs),
  ]);
  return { runs, wakes, findings, jobs, agents, hosts };
}

/**
 * The target's own hosts, off the executions' frozen config first and the stored target second.
 *
 * The snapshots are what the visits actually ran against, which is the address a transcript can be
 * quoting; the stored target covers a study whose executions kept no snapshot, and an address
 * somebody has since changed stays in the set because an old issue body is not rewritten. A
 * snapshot id is read once however many executions share it — they do share it, since
 * `findConfigSnapshotByHash` reuses one for identical config.
 */
async function targetHosts(store: Store, simulation: Simulation, runs: readonly Run[]): Promise<string[]> {
  const ids = [...new Set(runs.map((run) => run.configSnapshotId).filter((id) => id !== ""))];
  const [snapshots, target] = await Promise.all([Promise.all(ids.map((id) => store.getConfigSnapshot(id))), store.getTarget(simulation.targetId)]);
  const urls = [
    ...snapshots.flatMap((snapshot) => (snapshot === undefined ? [] : [...snapshot.config.target.mcp.map((endpoint) => endpoint.url), snapshot.config.target.webBaseUrl])),
    ...(target === undefined ? [] : [...target.mcp.map((endpoint) => endpoint.url), target.webBaseUrl]),
  ];
  return [...new Set(urls.flatMap((url) => (url === undefined ? [] : [hostOf(url)])).filter((host) => host !== WITHHELD))];
}

// ---- selection -------------------------------------------------------------

/**
 * What to consider, in the order to consider it.
 *
 * Named signatures keep the caller's order, because a reader who ticked three boxes gets three
 * answers in the order they are on the screen. Everything else goes worst first: a rate limit or a
 * dead connection part way through then costs the least important problems rather than an arbitrary
 * slice, and the reach number breaks the tie because nine people blocked is a bigger problem than
 * one person confused at the same severity.
 *
 * **A named signature is looked up against every MEMBER of a cluster and not only against its
 * representative.** The candidates here are clustered over the report WINDOW being published while
 * the screen the reader ticked boxes on is clustered over the whole EXECUTION — and the two
 * clusterings need not pick the same representative, or even draw the same boundaries: a
 * longitudinal study's screen can present one problem under a wording that the window's own
 * clustering has as a member of it. Matched on the representative alone, populace answered
 * `not-found` for a problem plainly visible on the page the button was pressed from.
 *
 * Two names CAN now land on one cluster, which is the shape that answer used to make impossible.
 * Each name still gets its own entry — a ticked box gets an answer — and the loop in
 * `publishIssues` deals with the cluster once and passes the second entry over as already written
 * to in this pass. Filing it twice is the one thing that must not happen, and the ledger read that
 * would have caught it happened before the first entry wrote its row.
 */
function select(problems: readonly PublishableCluster[], signatures: readonly string[] | undefined): PublishableCluster[] {
  if (signatures !== undefined) {
    const by = new Map<string, PublishableCluster>();
    for (const problem of problems) {
      // The representative first and in its own pass, so that where one cluster's member is
      // another cluster's representative the representative wins the key — it is the wording the
      // screen shows under that key.
      by.set(problem.card.signature, problem);
    }
    for (const problem of problems) {
      for (const signature of problem.signatures) if (!by.has(signature)) by.set(signature, problem);
    }
    return signatures.flatMap((signature) => {
      const problem = by.get(signature);
      return problem ? [problem] : [{ card: notFoundCard(signature), detail: null, signatures: [signature], skip: "not-found" }];
    });
  }
  return [...problems].sort(
    (a, b) => SEVERITY_RANK[a.card.severity] - SEVERITY_RANK[b.card.severity] || b.card.peopleHit - a.card.peopleHit || a.card.signature.localeCompare(b.card.signature),
  );
}

// ---- which wordings are one problem ----------------------------------------

/**
 * "These signatures are one problem", as the window arithmetic and every count below need it.
 *
 * `keys` is what `windowHistories` groups by; `members` is the whole set behind one group, which is
 * what a quiet duration, the reach numbers and the sighting lookup are all counted over.
 */
interface Grouping {
  /** Every signature this pass knows about, mapped to its component's key. */
  keys: Map<string, string>;
  /** That key, mapped to every signature in the component — cluster members and ledger rows alike. */
  members: Map<string, Set<string>>;
  keyOf: (signature: string) => string;
}

/**
 * The equivalence "shares a signature", closed over the selected clusters AND the ledger rows they
 * matched.
 *
 * This was a `Map<signature, clusterSignature>` filled in a loop, and that is last-writer-wins.
 * Two selected clusters can both match ONE ledger row — the shape the ledger produces whenever the
 * clusterer stops bridging two wordings it used to bridge, which is a title similarity threshold
 * away at any time — and that row's signatures were then written twice, so whichever cluster came
 * later in the loop owned them. The window history was looked up under a key the other cluster's
 * signatures had been folded into, and the single comment that went out was computed from the wrong
 * problem's history: a "gone quiet" on a problem that was reported an hour ago, or the reverse.
 *
 * The relation is transitive — A shares a signature with a row, the row shares one with B, so A and
 * B are one problem as far as the ledger is concerned — so the structure is union-find and the key
 * is the component's root. That is also exactly what `signatureHistories` wants: it counts presence
 * per GROUP and answers under the group key as well as under every member
 * (`packages/reports/src/signatures.ts`), so asking it for a root is asking for the history of the
 * whole component rather than of one wording of it.
 */
function groupsOf(selected: readonly PublishableCluster[], ledger: readonly (readonly FiledIssue[])[]): Grouping {
  const parent = new Map<string, string>();
  const root = (signature: string): string => {
    let at = signature;
    while (at !== (parent.get(at) ?? at)) at = parent.get(at) ?? at;
    // Path compression: a long chain of bridged wordings costs one walk rather than one per ask.
    parent.set(signature, at);
    return at;
  };
  const all = new Set<string>();
  selected.forEach((problem, index) => {
    const mine = [problem.card.signature, ...problem.signatures, ...(ledger[index] ?? []).flatMap((row) => row.signatures)];
    const first = mine[0];
    if (first === undefined) return;
    for (const signature of mine) {
      all.add(signature);
      const [x, y] = [root(first), root(signature)];
      if (x !== y) parent.set(y, x);
    }
  });
  const keys = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  for (const signature of all) {
    const key = root(signature);
    keys.set(signature, key);
    members.set(key, (members.get(key) ?? new Set<string>()).add(signature));
  }
  return { keys, members, keyOf: (signature) => keys.get(signature) ?? signature };
}

/**
 * A stand-in for a signature the caller named and this study's results do not carry, so the loop
 * below has one shape. Nothing reads any field of it but the signature and the skip.
 */
function notFoundCard(signature: string): ClusterCardView {
  return {
    signature,
    title: "",
    severity: "low",
    kind: "bug",
    tool: null,
    verdict: null,
    peopleHit: 0,
    peopleTotal: 0,
    reports: 0,
    cohorts: [],
    inLatest: false,
    state: "fixed",
    seenIn: [],
    firstSeenAt: null,
    lastSeenAt: null,
    triage: null,
    filedIssue: null,
  };
}

/**
 * The connection's filter, which narrows what the automatic path may file and never widens it.
 *
 * It is asked only on the path that OPENS an issue. A problem that already has one gets its comment
 * whatever the filter says: the filter is about what lands in somebody's tracker, and the issue is
 * already there — falling silent on it because a later `minSeverity` excludes it would leave a
 * reader following a record populace had quietly stopped keeping.
 */
function filterSkip(card: ClusterCardView, filter: GithubConnection["filter"]): PublishSkipReason | null {
  if (!filter.kinds.includes(card.kind)) return "kind";
  // Ranks ascend as severity descends: `critical` is 0 and `low` is 3, so "at least this severe"
  // is a rank no greater than the floor's.
  if (SEVERITY_RANK[card.severity] > SEVERITY_RANK[filter.minSeverity]) return "severity";
  if (filter.onlyConfirmed && card.verdict !== "confirmed") return "unconfirmed";
  return null;
}

// ---- one problem -----------------------------------------------------------

type LabelState = { state: "unasked" } | { state: "ready"; labels: string[] } | { state: "refused"; why: string };

interface Work {
  problem: PublishableCluster;
  matched: readonly FiledIssue[];
  named: boolean;
  connection: GithubConnection & { token: string };
  client: IssueClient;
  store: Store;
  simulation: Simulation;
  rows: StudyRows;
  windows: readonly ReportWindow[];
  current: ReportWindow | undefined;
  /**
   * Every signature in this problem's group: its cluster's members and the signatures of every
   * ledger row that matched them (`groupsOf`).
   *
   * It is the group and not `problem.signatures` because the group is what the window history was
   * computed over, and a number counted over a narrower set than the state it is printed beside is
   * a false claim. A problem filed under wording A and now reported under wording B has both in its
   * group: counted over B alone, the last report is in this window and the quiet duration is nought
   * cycles while the history says it has been quiet for three.
   */
  group: ReadonlySet<string>;
  /** The group's standing across the study's report windows. Undefined refuses; it does not guess. */
  history: SignatureHistory | undefined;
  touched: Set<number>;
  at: () => string;
  labels: () => LabelState;
  setLabels: (next: LabelState) => void;
  search: () => SearchState;
  setSearch: (next: SearchState) => void;
  asked: Map<string, IssueRef | null>;
}

/**
 * One problem, from the skips through to the ledger row.
 *
 * The order of the tests is the whole policy, and it is not the order the skip reasons are listed
 * in. Praise, a settled signature and a duplicate are a human's judgement or nothing to fix, and
 * they stand whether or not an issue exists — populace does not keep writing into a record whose
 * subject somebody has closed the book on. Then the LEDGER, before the absence test, because an
 * absence is exactly what the comment path exists to report: a problem that has gone quiet since it
 * was filed is the payload of the whole loop. An absence that was never filed has no issue to say
 * it in and nothing worth opening one about.
 */
async function dealWith(work: Work): Promise<PublishIssueResult> {
  const card = work.problem.card;
  const hard = work.problem.skip;
  if (hard === "praise" || hard === "settled" || hard === "duplicate" || hard === "not-found") return skipped(card.signature, hard);

  if (work.matched.length > 0) return comment(work);

  if (hard === "absent") return skipped(card.signature, "absent");
  if (!work.named) {
    const narrowed = filterSkip(card, work.connection.filter);
    if (narrowed !== null) return skipped(card.signature, narrowed);
  }
  return file(work);
}

function skipped(signature: string, reason: PublishSkipReason): PublishIssueResult {
  return { signature, outcome: "skipped", summary: `Passed over: ${skipWords(reason)}.`, issue: null, reason, error: null };
}

/** Why a problem was passed over, in a phrase a screen can drop into a sentence. */
function skipWords(reason: PublishSkipReason): string {
  switch (reason) {
    case "praise":
      return "somebody said the product did well here, so there is nothing to fix";
    case "settled":
      return "a human has already ruled on this one";
    case "duplicate":
      return "a human said this is another problem under a different title";
    case "absent":
      return "the report this reads was not reported in the latest report cycle, and an absence is not something to file";
    case "already-filed":
      return "this went out as an issue before, and the record of it has already been added to in this pass";
    case "kind":
      return "this kind of report is not one the connection files";
    case "severity":
      return "below the severity the connection files";
    case "unconfirmed":
      return "the connection files only what the re-check confirmed";
    case "not-found":
      return "this study's results do not carry that key";
  }
}

// ---- opening an issue ------------------------------------------------------

async function file(work: Work): Promise<PublishIssueResult> {
  const card = work.problem.card;
  const built = bodyFor(work);
  if (built === undefined) {
    return {
      signature: card.signature,
      outcome: "failed",
      summary: "populace could not read this problem back to write it up — it may have been clustered differently since the results were read.",
      issue: null,
      reason: null,
      error: "the problem is no longer in this study's results under that key",
    };
  }

  // The second line of defence, asked only here: the ledger did not match, so either this has never
  // been filed or the ledger that knew about it is gone. An eventually-consistent search answers
  // "nothing found" and never "nothing exists", which is why the ledger is the primary record and
  // this is the backstop.
  const found = await findByMarker(work);
  if (found.outcome === "could-not-answer") {
    // The refusal that matters most in this file. A search that did NOT answer used to be read as
    // one that found nothing, and the next line created an issue — so one rate limit, or one proxy
    // in front of github.com, filed a duplicate of every problem whose ledger row was gone. A
    // skipped issue is recoverable by running the pass again; a duplicate in somebody's public
    // tracker is not recoverable at all, so populace refuses to create when it cannot check.
    return {
      signature: card.signature,
      outcome: "failed",
      summary: "populace could not check whether this is already filed, so it did not open a second issue.",
      issue: null,
      reason: null,
      error: found.failure.message,
    };
  }
  if (found.outcome === "found") return commentOnFound(work, found.issue, built.title);

  const labels = await ensureLabels(work);
  const created = await work.client.createIssue({ title: built.title, body: built.body, labels: labels.state === "ready" ? labels.labels : [] });
  if (!created.ok) {
    return { signature: card.signature, outcome: "failed", summary: `populace could not open an issue in ${work.connection.repo}: ${created.message}`, issue: null, reason: null, error: created.message };
  }

  // The ledger row goes in IMMEDIATELY, before the next problem is looked at, so a process that
  // dies half way through has not lost the record of what it filed. Between the create above and
  // this write there is a window where the issue exists and the ledger does not know it — which is
  // precisely what the marker in the body is for.
  // GitHub's own `created_at` for the issue it just opened, with the local clock only as the
  // fallback: for a create the two are the same moment, so this is about having ONE rule for
  // `filedAt` — the issue's own opening time, whoever reports it — rather than two.
  const row = await writeLedger(work, created.issue, built.title, created.issue.createdAt ?? work.at());
  const note = labels.state === "refused" ? ` (without labels — ${labels.why})` : "";
  await recordIssue(work, "issue.opened", created.issue, work.problem.signatures.length);
  return {
    signature: card.signature,
    outcome: "filed",
    summary: `Filed as ${work.connection.repo}#${created.issue.number}${note}.`,
    issue: viewOf(row),
    reason: null,
    error: null,
  };
}

/**
 * The title and the body, with the marker block where a cut cannot reach it.
 *
 * Composition order is load-bearing. `fitIssueBody` cuts from the END — the document descends in
 * importance and the tail of a transcript is the part a reader can still open in populace — so the
 * markers go at the TOP, because a marker cut off by the fit is a dedupe defence that is present
 * exactly when it is not needed. The title's redaction count goes at the bottom with the body's
 * own note about the same thing, and a body long enough to lose it says instead that text was
 * removed from the end, which is the truth and is louder.
 */
function bodyFor(work: Work): { title: string; body: string } | undefined {
  // The detail comes back BESIDE the card, off the one study context the read model loaded
  // (`PublishableCluster.detail`). It used to be fetched here with `readModel.cluster()`, which
  // rebuilds the whole context per call — every execution, every visit, every report and two
  // clustering passes — so a bulk pass over forty problems did that forty times to write forty
  // bodies off one set of rows. Null is only the synthetic `not-found` candidate, which is refused
  // on its skip long before anything reads a detail off it.
  const detail = work.problem.detail;
  if (detail === null) return undefined;
  // **Fail CLOSED.** This used to fire on `visibility === "public"` alone, which is a reduction
  // that does not happen for the state populace is in most of the time: `unknown` is the DEFAULT
  // (`GithubConnectionSchema`), it is where every connection sits until somebody presses Check, and
  // it is where a connection lands again the moment it is re-pointed at another repository. So the
  // automatic path published the target's real MCP endpoints, its web base and every absolute
  // self-URL the product printed into the transcript — query strings included — into a repository
  // populace had no idea was world-readable. ADR-0044 has `unknown` in the enum precisely because
  // populace does not know, and the one safe reading of "I do not know whether this is public" is
  // "treat it as public": a reduced address costs a reader a path they can ask populace for, and an
  // address published to a world-readable tracker cannot be taken back.
  const reduce = work.connection.visibility !== "private";
  const safe = reduce ? withoutAddresses(detail, work.rows.hosts) : detail;
  const title = issueTitleOf(safe);
  const prompt = buildFixPrompt(safe);
  const markers = [...new Set([work.problem.card.signature, ...work.problem.signatures])].slice(0, MARKERS_IN_BODY).map((signature) => `<!-- ${markerFor(signature)} -->`);
  // The address note goes at the TOP with the markers, for the same reason they do: `fitIssueBody`
  // cuts from the END, and a caveat about what is and is not in the body below it is worth nothing
  // if a long transcript can push it off the bottom.
  const fitted = fitIssueBody([markers.join("\n"), addressNote(reduce, work.connection.visibility), prompt.text, titleNote(title.redactions)].join("\n"));
  return { title: title.title, body: fitted.text };
}

/**
 * What the address reduction did, and — the part that makes it honest — what it did not.
 *
 * The reduction is a narrowing of the addresses **populace was configured with**: an absolute URL
 * whose host is one of this target's own hosts, wherever it appears. It is not a scrub of the
 * product's output. The transcript quotes what the product said back, verbatim apart from that one
 * substitution and the credential redaction the prompt already counts, so another service's
 * address, an internal name that is not a URL, an account id or a stack frame goes out in full.
 *
 * Saying so is not a hedge. A reader who is told "addresses are reduced on a public repository" and
 * is not told the rest will file into a world-readable tracker believing a body was sanitised, and
 * that belief is the risk rather than the body. The same sentence belongs on the confirmation the
 * dashboard shows before an automatic file, which is `packages/web`'s copy and not this file's.
 */
function addressNote(reduced: boolean, visibility: GithubConnection["visibility"]): string {
  if (!reduced) return "";
  const why =
    visibility === "public"
      ? "This repository is world-readable"
      : "populace has not confirmed this repository is private — nobody has checked it, or it has been pointed somewhere new — so it is treated as world-readable";
  return `\n_${why}, so every address populace was configured with has been reduced to its bare host: the product's MCP endpoints, its web address, and any absolute link to one of those hosts anywhere below, each edit marked in place. **Nothing else is scrubbed.** The product's own replies are quoted as they came back, so any other address, identifier or internal name they printed is here in full._\n`;
}

/**
 * A public repository is a different risk rather than a different preference.
 *
 * The body carries the target's real MCP endpoint, and on a world-readable repository that
 * publishes an internal staging address — and any credential a query string carries — to everybody
 * for good. Reduced to the bare host, the reader still learns which service the calls went to,
 * which is what the address is in the prompt for. The product description and the cohorts' briefs
 * stay: they are what makes the report actionable, and they are what the extra confirmation naming
 * the repository as public exists to make somebody take on knowingly.
 *
 * **The pass is not one field deep, and that is the whole point of this function's shape.** It
 * used to reduce `product.endpoints` and nothing else, while three or four inches further down the
 * same body quoted the product's own responses verbatim — and a real product puts absolute
 * self-URLs in its output constantly: a `Location`, a `next` page link, a resource URL in an error.
 * So a body that had carefully reduced `https://staging.internal:8443/mcp` to `staging.internal:8443`
 * then printed the whole thing back inside a tool result, and the reduction was a claim populace
 * was making and not a thing it was doing.
 *
 * So every string a body can print goes through the same reduction: the report's own prose, the
 * people's quotes, the reproduction and the replay — arguments, results and structured content
 * alike — and the judge's reason. What gets reduced is an absolute URL whose host is one of THIS
 * target's own hosts, and nothing else: a link to somebody else's service is the product's own
 * output and reducing it would be editing the evidence. Each one is replaced by the host plus a
 * marker, because the prompt tells its reader that every removal is marked in place
 * (`buildFixPrompt`), and an unmarked edit to a transcript makes that sentence untrue.
 */
function withoutAddresses(detail: ClusterDetailView, extra: readonly string[]): ClusterDetailView {
  // The detail's own endpoints, plus every host the study's config knows the product by
  // (`StudyRows.hosts`). The second is not a nicety: the WEB BASE appears in no field of a
  // `ClusterDetailView`, so the reduction could not see it — and it is the address `fetch_page`
  // puts through the transcript, which is the part of the body a reader spends longest in.
  const hosts = new Set([...detail.product.endpoints.map((endpoint) => hostOf(endpoint.url)), ...extra].filter((host) => host !== WITHHELD));
  const text = (value: string): string => reduceAddresses(value, hosts);
  const step = (call: ToolCallRecord): ToolCallRecord => ({
    ...call,
    endpoint: text(call.endpoint),
    arguments: jsonWithout(call.arguments, text),
    result: {
      ...call.result,
      text: text(call.result.text),
      // Not printed by the prompt today. Reduced anyway, because the next field the prompt learns
      // to print should not be the one that reinstates this.
      ...(call.result.structured === undefined ? {} : { structured: jsonWithout(call.result.structured, text) }),
    },
  });
  const finding = detail.representative;
  return {
    ...detail,
    title: text(detail.title),
    representative: { ...finding, title: text(finding.title), description: text(finding.description), expected: text(finding.expected), observed: text(finding.observed) },
    quotes: detail.quotes.map((quote) => ({ ...quote, text: text(quote.text) })),
    reproduction: detail.reproduction.map(step),
    replay: detail.replay === null ? null : { ...detail.replay, reason: text(detail.replay.reason), replay: detail.replay.replay.map(step) },
    product: {
      ...detail.product,
      description: detail.product.description === null ? null : text(detail.product.description),
      endpoints: detail.product.endpoints.map((endpoint) => ({ name: endpoint.name, url: hostOf(endpoint.url) })),
    },
    conditions: detail.conditions.map((condition) => ({ ...condition, context: text(condition.context) })),
  };
}

/** What an endpoint reads as when it is not a URL at all, and so has no host to reduce it to. */
const WITHHELD = "address withheld";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    /* not a URL at all: say nothing rather than pass an unparsed string through as a host */
    return WITHHELD;
  }
}

/**
 * Absolute `http`/`https` URLs, stopping at whitespace or at the punctuation that ends a URL in
 * prose, in JSON or in Markdown rather than belonging to it.
 */
const ABSOLUTE_URL = /https?:\/\/[^\s"'`<>()[\]{},\\]+/gi;

/** Trailing punctuation that is the sentence's and not the address's. */
const TRAILING = /[.,;:!?]+$/;

/**
 * One string with every URL pointing at one of the target's own hosts reduced to that host.
 *
 * A URL that will not parse, or whose host is somebody else's, is returned untouched: this is a
 * narrowing of what populace publishes about its own target and never an edit of what the product
 * said about anybody else's.
 */
function reduceAddresses(value: string, hosts: ReadonlySet<string>): string {
  if (hosts.size === 0 || !value.includes("://")) return value;
  return value.replace(ABSOLUTE_URL, (match) => {
    const trailing = TRAILING.exec(match)?.[0] ?? "";
    const url = match.slice(0, match.length - trailing.length);
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return match;
    }
    if (!hosts.has(host)) return match;
    // The host alone when that is all there was, and the host plus a marker when a path or a query
    // has gone: the marker is what tells a reader the transcript was edited here, which is the
    // claim the prompt's own preamble makes about every removal in it.
    const bare = url.replace(/\/+$/, "") === new URL(url).origin;
    return `${host}${bare ? "" : "/[address reduced]"}${trailing}`;
  });
}

/**
 * The same reduction through a JSON value, which is what a tool's arguments and its structured
 * result are.
 *
 * Recursive over the value rather than over its serialisation: re-parsing edited JSON text is a
 * boundary that can fail, and a failure here would have to choose between publishing the unedited
 * original and dropping the evidence. Walking the value cannot fail.
 */
function jsonWithout(value: JsonValue, text: (value: string) => string): JsonValue {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map((item) => jsonWithout(item, text));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonWithout(item, text)]));
  return value;
}

/**
 * The title's redactions, added to the body's footer so the count a reader is given covers
 * everything that left populace rather than only the transcript.
 *
 * `buildFixPrompt` counts its own and says so; the title goes through `redactText` separately and
 * is the one field that lands in a search index, so a body claiming "nothing matched a credential
 * shape" while the title had two removed is the count quietly becoming a lie.
 */
function titleNote(redactions: number): string {
  if (redactions === 0) return "";
  return `\n_A further ${plural(redactions, "value")} in this issue's title looked like a credential and ${redactions === 1 ? "was" : "were"} replaced before it left populace. The count above covers the body only._\n`;
}

/** The labels, created once per publish and only when something is actually about to be opened. */
async function ensureLabels(work: Work): Promise<LabelState> {
  const current = work.labels();
  if (current.state !== "unasked") return current;
  if (work.connection.labels.length === 0) {
    const none: LabelState = { state: "ready", labels: [] };
    work.setLabels(none);
    return none;
  }
  const outcome = await work.client.ensureLabels(work.connection.labels);
  // A label GitHub does not know fails the whole create with a 422, which would lose the issue over
  // a piece of decoration. So a refusal drops the labels for this pass and the issue still goes
  // out, said out loud in the result rather than swallowed.
  const next: LabelState = outcome.ok ? { state: "ready", labels: work.connection.labels } : { state: "refused", why: outcome.message };
  work.setLabels(next);
  return next;
}

/**
 * The issue a marker search found — or, and this is the distinction the whole refusal above rests
 * on, the fact that the search did not answer.
 *
 * Three answers and not two, because a search that found nothing and a search that was refused
 * read identically through an empty list and lead to opposite actions. `searchIssues` is typed to
 * make that impossible to collapse by accident (`MarkerSearch` in `./github.js`), and this keeps
 * the distinction on the way out.
 *
 * Two economies, both about a bulk pass rather than about one problem. A marker is asked about at
 * most once per pass, so two problems whose groups share a wording do not ask twice. And the first
 * refusal stops every later search: a rate-limited search endpoint will refuse the next hundred
 * requests too, and the answers would be unusable anyway.
 */
async function findByMarker(work: Work): Promise<MarkerLookup> {
  const state = work.search();
  if (state.state === "unavailable") return { outcome: "could-not-answer", failure: state.failure };
  const signatures = [...new Set([work.problem.card.signature, ...work.problem.signatures])].slice(0, MARKERS_SEARCHED);
  for (const signature of signatures) {
    const marker = markerFor(signature);
    const before = work.asked.get(marker);
    if (before !== undefined) {
      if (before !== null) return { outcome: "found", issue: before };
      continue;
    }
    const found = await work.client.searchIssues(marker);
    if (found.outcome === "could-not-answer") {
      work.setSearch({ state: "unavailable", failure: found.failure });
      return { outcome: "could-not-answer", failure: found.failure };
    }
    if (found.outcome === "none") {
      work.asked.set(marker, null);
      continue;
    }
    work.asked.set(marker, found.issues[0]);
    return { outcome: "found", issue: found.issues[0] };
  }
  return { outcome: "none" };
}

/**
 * An issue the marker found and the ledger did not know about: the schema-rebuild case, which is
 * the whole reason the marker is in the body.
 *
 * A ledger row is recorded before the comment, because from here on the local record is what keeps
 * this from being filed again. Two things about HOW it is recorded, and both were wrong.
 *
 * **It grows an existing row before it writes a new one.** `saveFiledIssue` is a whole-row upsert,
 * so writing blind over the number the search returned overwrites whatever is there — and the very
 * reason this path runs is that the reader did not see a row: a row the reader skipped because this
 * build cannot parse it is exactly the case where overwriting is the wrong answer, and so is a row
 * whose signatures did not intersect this cluster's. `growFiledIssue` unions into it in one
 * transaction and keeps its own `filedAt`, which is the truest date anybody has.
 *
 * **It never stamps a filing date it made up.** The issue may have been opened months ago, and
 * every tie-break in the dedupe rule is "the oldest `filedAt` wins, because that is the issue a
 * reader has been following" (`FiledIssueSchema`) — so a row stamped with the current clock does
 * not merely show a reader a false date on a screen, it can permanently send every future comment
 * to the wrong issue. GitHub's `created_at` is the answer, and where GitHub did not say, populace
 * records nothing and says so: it has found an issue carrying this problem's marker, so there is
 * no duplicate to worry about, and the next pass finds it the same way.
 */
async function commentOnFound(work: Work, found: IssueRef, title: string): Promise<PublishIssueResult> {
  const grown = await work.store.growFiledIssue(keyFor(work, found.number), { signatures: work.problem.signatures, seenIn: sightingsFor(work), updatedAt: work.at() });
  if (grown !== undefined) return comment({ ...work, matched: [grown] });
  if (found.createdAt === null) {
    return {
      signature: work.problem.card.signature,
      outcome: "failed",
      summary: `populace found ${work.connection.repo}#${found.number} already carrying this problem's marker, so it opened nothing — but GitHub did not say when that issue was opened, so there was no honest date to record it under and populace wrote nothing at all.`,
      issue: null,
      reason: null,
      error: "the issue was found by its marker but GitHub reported no creation date for it",
    };
  }
  const row = await writeLedger(work, found, title, found.createdAt);
  return comment({ ...work, matched: [row] });
}

/** One ledger row addressed the way the table is keyed: an issue number means nothing on its own. */
function keyFor(work: Work, number: number): { projectId: string; provider: typeof PROVIDER; repo: string; number: number } {
  return { projectId: work.simulation.projectId, provider: PROVIDER, repo: work.connection.repo, number };
}

/**
 * The row for one issue, parsed through the schema so a field added later cannot be forgotten.
 *
 * `filedAt` is an argument rather than the clock: it is when the ISSUE was opened, which for a
 * create is now and for an issue found by its marker is whatever GitHub says. See `commentOnFound`
 * for why guessing it is not a cosmetic error.
 */
async function writeLedger(work: Work, issue: IssueRef, title: string, filedAt: string): Promise<FiledIssue> {
  const row = FiledIssueSchema.parse({
    projectId: work.simulation.projectId,
    provider: PROVIDER,
    repo: work.connection.repo,
    number: issue.number,
    url: issue.url,
    title,
    signatures: work.problem.signatures,
    seenIn: sightingsFor(work),
    supersededBy: null,
    filedAt,
    updatedAt: work.at(),
  });
  await work.store.saveFiledIssue(row);
  return row;
}

/**
 * The window this problem was reported in, as the ledger records a sighting.
 *
 * `(studyId, runId, seq, window)` and not a bare `seq`: a longitudinal study has one execution for
 * its whole life, so `seq` alone is 1 for ever and cycle 7 would be indistinguishable from a
 * double-publish of cycle 1. Empty when the problem is not in the current window at all, which is
 * the gone-quiet case — there is no sighting to record, and inventing one would make the history
 * say the problem was reported in the very window whose silence the comment is about.
 */
function sightingsFor(work: Work): FiledIssueSighting[] {
  const window = work.current;
  if (window === undefined) return [];
  // The GROUP's signatures, which is what the history and every count in a comment use: a problem
  // reported this window under a wording the ledger row already carries has been seen, and reading
  // that as no sighting would record a gap in the one record a reader trusts to be a history.
  if (!window.findings.some((finding) => work.group.has(finding.signature))) return [];
  return [{ studyId: work.simulation.id, runId: window.runId, seq: window.seq, window: window.cycle, at: window.closedAt ?? work.at() }];
}

// ---- commenting on one already filed ---------------------------------------

/**
 * A problem that already has an issue. This is where the copy rules bite hardest, and the one
 * place populace writes into a record a human is reading.
 *
 * Which of three things is said comes off the report-window state and nothing else: reported again,
 * gone quiet, or back. The issue is reopened when it is closed and the problem was reported again
 * — the record belongs where the reader is looking — and the comment says what was observed and
 * nothing about why it was closed, because populace cannot tell a fix from a triage decision from
 * somebody tidying up.
 */
async function comment(work: Work): Promise<PublishIssueResult> {
  const card = work.problem.card;
  // The oldest that has not itself been absorbed: it is the issue a reader has been following, and
  // a superseded row still matches deliberately so that following its pointer is the caller's job
  // rather than a re-file.
  const ordered = [...work.matched].sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.number - b.number);
  const target = ordered.find((row) => row.supersededBy === null) ?? ordered[0];
  if (target === undefined) return skipped(card.signature, "already-filed");
  if (work.touched.has(target.number)) return skipped(card.signature, "already-filed");

  // Refused rather than guessed, and asked before anything goes out, because a comment populace
  // cannot word is not worth a request. The guess this replaces is worth naming: it was
  // `card.inLatest ? "open" : "fixed"` — one CLUSTER's presence in one window, standing in for a
  // claim about a SEQUENCE of windows that only the group's history can answer. It cannot tell
  // "reported again" from "back", and on a group two clusters were bridged into by one ledger row
  // it is not even about the same problem. A missing history means the grouping and the windows
  // disagree about what was reported at all, and populace writing the wrong one of those three
  // things into a record somebody is reading is worse than populace writing nothing this pass.
  const history = work.history;
  if (history === undefined) {
    return {
      signature: card.signature,
      outcome: "failed",
      summary: `populace could not work out where this problem stands across this study's ${cycleWords(work, 2)}, so it wrote nothing on ${work.connection.repo}#${target.number}.`,
      issue: viewOf(target),
      reason: null,
      error: "no report-window history for any of this problem's signatures",
    };
  }
  // And refused for the same reason when nobody has visited at all. Every sentence a comment can
  // make is about what people did or did not do in a stretch of time, and with no visited window
  // there is no such stretch: the gone-quiet line reads "nobody has reported this in the last 0
  // report cycles", and the incidence line divides a count by a roster of nobody. A study created
  // and not yet under way is exactly when reading silence as an absence is most wrong.
  if (work.current === undefined || !work.current.visited) {
    return {
      signature: card.signature,
      outcome: "failed",
      summary: `Nobody has visited this study yet, so populace has nothing it could honestly say on ${work.connection.repo}#${target.number} and wrote nothing.`,
      issue: viewOf(target),
      reason: null,
      error: "no report window of this study has been visited",
    };
  }

  // Superseded rows that have NOT already been announced. The line below says "a later report
  // joined the two under one title", which is news exactly once: a row this pass is about to point
  // at `target` gets it, and a row that was pointed there by an earlier pass has had it. Without
  // the filter every comment on the issue for ever after repeated the same sentence.
  //
  // It is computed HERE, above the outbound read, because the gone-quiet guard below needs to know
  // whether there is anything else worth a comment before it decides to write nothing.
  const absorbing = ordered.filter((row) => row.number !== target.number && row.supersededBy === null);

  /**
   * **A gone-quiet comment is NEWS, and news is said once.**
   *
   * Nothing used to bound this. Once a filed problem stopped being reported, every later report
   * window wrote the absence again with a bigger number in it, for the rest of the study's life —
   * on the default hourly cycle roughly a hundred and seventy comments a week, landing on exactly
   * the issues whose repairs had just worked. The comment a developer is meant to read after their
   * pull request lands became the reason they muted the issue.
   *
   * So the notice is recorded on the ledger row and compared on WHAT went quiet rather than on
   * when somebody published: `since` is the last window that did report it, so every later quiet
   * cycle carries the same one and is the same news. The problem coming back and going quiet again
   * looks back at a later window, so it is news once more — and coming back is the `regressed`
   * comment's own announcement in between (`FiledIssueQuietNoticeSchema`).
   *
   * The `absorbing` clause is not a loophole in that. A row this pass is about to point at this
   * issue has never been cross-referenced on it, and that sentence is its own piece of news; going
   * silent on it would orphan a record with nothing saying where it went.
   */
  const quiet = history.inLatest ? null : quietFor(work);
  if (quiet !== null && absorbing.length === 0) {
    const since = quiet.last?.ordinal ?? 0;
    if (target.quietNotices.some((notice) => notice.studyId === work.simulation.id && notice.since === since)) {
      return {
        signature: card.signature,
        outcome: "skipped",
        summary: `populace has already said on ${work.connection.repo}#${target.number} that this stopped being reported, and it has not been reported since, so there is nothing new to say.`,
        issue: viewOf(target),
        reason: "absent",
        error: null,
      };
    }
  }

  const standing = await work.client.getIssue(target.number);
  if (!standing.ok) {
    return { signature: card.signature, outcome: "failed", summary: `populace could not read ${work.connection.repo}#${target.number}: ${standing.message}`, issue: viewOf(target), reason: null, error: standing.message };
  }

  // Off the window-scoped fact and not off the state's spelling: `inLatest` is "the newest window
  // anybody visited reported this", which is exactly the condition under which a closed issue
  // should be open again.
  const reopen = standing.issue.state === "closed" && history.inLatest;
  if (reopen) {
    const reopened = await work.client.reopenIssue(target.number);
    if (!reopened.ok) {
      return { signature: card.signature, outcome: "failed", summary: `populace could not reopen ${work.connection.repo}#${target.number}: ${reopened.message}`, issue: viewOf(target), reason: null, error: reopened.message };
    }
  }

  const body = commentBody(work, { history, quiet, reopened: reopen, superseded: absorbing });
  const added = await work.client.addComment(target.number, body);
  if (!added.ok) {
    return { signature: card.signature, outcome: "failed", summary: `populace could not comment on ${work.connection.repo}#${target.number}: ${added.message}`, issue: viewOf(target), reason: null, error: added.message };
  }
  work.touched.add(target.number);

  // Atomically, and never read-modify-write: the single-problem route runs outside the serial job
  // queue, so a bulk pass and one click interleave here and a `get` plus a `save` would drop one of
  // the two sets of signatures — which is the duplicate the ledger exists to prevent.
  // The absence announcement is recorded in the SAME atomic growth, and only when one went out:
  // `(studyId, since)` is dropped there if it is already present, so two passes that both got this
  // far still leave one notice rather than two.
  const grown = await work.store.growFiledIssue(keyFor(work, target.number), {
    signatures: work.problem.signatures,
    seenIn: sightingsFor(work),
    ...(quiet === null ? {} : { quietNotices: [{ studyId: work.simulation.id, since: quiet.last?.ordinal ?? 0, at: work.at() }] }),
    updatedAt: work.at(),
  });
  for (const row of ordered) {
    if (row.number === target.number || row.supersededBy === target.number) continue;
    await work.store.growFiledIssue(keyFor(work, row.number), { signatures: [], seenIn: [], updatedAt: work.at(), supersededBy: target.number });
  }

  await recordIssue(work, "issue.commented", { number: target.number, url: target.url }, work.problem.signatures.length);
  return {
    signature: card.signature,
    outcome: "commented",
    summary: `${stateWords(history)} on ${work.connection.repo}#${target.number}${reopen ? ", which populace reopened" : ""}.`,
    issue: viewOf(grown ?? target),
    reason: null,
    error: null,
  };
}

/** The headline of a comment, and the phrase the result summary uses for the same thing. */
function stateWords(history: SignatureHistory): string {
  if (!history.inLatest) return "Said it has gone quiet";
  if (history.state === "regressed") return "Said it is back";
  // "Again" only where there is more than one sighting to be again of, which is the same test the
  // comment's own headline makes (`commentBody`).
  if (history.state === "new" || history.seenIn.length <= 1) return "Said it was reported";
  return "Said it was reported again";
}

interface CommentShape {
  /** The group's standing over the study's report windows, which decides which of three is said. */
  history: SignatureHistory;
  /**
   * How long it has been quiet and where the last report was, or null when this window reported it.
   *
   * It is computed once by the caller rather than here because the caller needs it too: the last
   * report is what the absence is news ABOUT, and the ledger records it so the same absence is not
   * announced a second time (`FiledIssueQuietNoticeSchema`).
   */
  quiet: Quiet | null;
  reopened: boolean;
  superseded: readonly FiledIssue[];
}

/**
 * The comment itself.
 *
 * Every number in it is counted rather than judged, and over the same stretch of time as the
 * sentence it is under. Which of three things is said comes off the group's window history and
 * nothing else — `inLatest` for whether the window being published reported it at all, and the
 * state's own sequence for the one claim only a sequence can support.
 *
 * The gone-quiet branch is the one to read twice: it reports an ABSENCE with the reach that
 * supports it, names the people who walked away separately because their silence is not a verdict
 * on anything, and carries the product's own caveat verbatim. "fixed", "verified", "resolved" and
 * "no longer reproducible" appear in none of it (`DESIGN-SYSTEM.md` §7.3); `regressed`'s own word,
 * "back", is populace describing its own sequence of observations — present, absent, present again
 * — which is what `signatures.ts` defines it as, and is a different claim from anything about why
 * an issue was closed.
 */
function commentBody(work: Work, shape: CommentShape): string {
  const lines: string[] = [];
  const where = whereWords(work);

  if (shape.quiet !== null) {
    lines.push(...quietLines(work, shape.quiet));
  } else if (shape.history.state === "regressed") {
    lines.push(
      `**Back.** This was reported, went quiet, and has been reported again in ${where}.`,
      "",
      ...incidenceLines(work, shape.history),
      "",
      "That is populace describing its own sequence of observations — reported, then absent, then reported again. It is not a reading of anything that happened to this issue.",
    );
  } else if (shape.history.state === "new" || shape.history.seenIn.length <= 1) {
    // Its own sentence, because "reported AGAIN" was being written over a problem whose only
    // report in populace's whole record is the one being published — the marker-search case, where
    // the issue is older than the local ledger, and any second publish of one window. "Again" of a
    // single sighting is a claim about a history that does not exist.
    lines.push(
      `**Reported.** populace's people hit this in ${where}. That is the only ${cycleWords(work, 1)} populace has a report of it in.`,
      "",
      ...incidenceLines(work, shape.history),
    );
  } else {
    lines.push(`**Reported again.** populace's people hit this again in ${where}.`, "", ...incidenceLines(work, shape.history));
  }

  if (shape.reopened) {
    lines.push(
      "",
      "This issue was closed, and populace has reopened it because the problem was reported again. populace cannot tell why it was closed — a repair, a triage decision, a duplicate, a tidy-up — and is making no claim about that.",
    );
  }

  for (const row of shape.superseded) {
    lines.push("", `Also filed as #${row.number}. A later report joined the two under one title, so populace keeps the record here from now on.`);
  }

  if (shape.history.inLatest) {
    lines.push(
      "",
      "Outcomes vary between executions by design — populace sends people through the product, it does not replay a script — so this is one window onto it rather than a claim about what the next execution would find.",
    );
  }
  return lines.join("\n");
}

/**
 * The gone-quiet comment, which is the payload of the whole loop: the thing a reader sees after a
 * pull request lands.
 *
 * What it may claim is bounded by who could actually have come back. People who hit the problem and
 * kept going do return, carrying memory, and their continued non-reporting is real evidence.
 * A person who walked away over it does not: a give-up retires them and `listDueAgents` selects
 * only the active, so they are never heard from again inside the same execution. Counting their
 * silence among the people who came back and said nothing would be putting words in the mouth of
 * somebody who left.
 */
function quietLines(work: Work, quiet: Quiet): string[] {
  // The GROUP's reports and not the cluster's own members'. The quiet duration and the state above
  // it are computed over the group — cluster signatures union every matched ledger row's — so
  // counting the reach over a narrower set would claim a problem had been quiet for more cycles
  // than it has, which is the "absence" claim this comment exists to make being made wrongly.
  const findings = work.rows.findings.filter((finding) => work.group.has(finding.signature));
  const reach = problemReach({ findings, agents: work.rows.agents, wakes: work.rows.wakes, runs: work.rows.runs });
  const last = quiet.last === undefined ? `before any ${cycleWords(work, 1)} populace still has on record` : `in ${windowWords(quiet.last)}`;

  const lines = [
    `**Gone quiet.** In ${studyWords(work)}, nobody has reported this in ${quiet.cycles === 1 ? `the latest ${cycleWords(work, 1)}` : `the last ${String(quiet.cycles)} ${cycleWords(work, quiet.cycles)}`}; the most recent report was ${last}.`,
    "",
  ];
  // `hit` is PEOPLE; every status below it is PARTICIPATIONS — one person in one execution, which is
  // the only unit that HAS a status, because walking away, hitting a visit cap and being woken
  // again all happen inside one execution (`ProblemReach`). The two are the same number for a study
  // with one execution and diverge the moment somebody hits the same problem in two, so the
  // fraction is taken over participations and the headline stays in people: "2 of the 3 people who
  // hit this" said of three participations by two people is a sentence about more people than exist,
  // and "3 people hit this" of the same data is a claim about a person who does not exist.
  const same = reach.participations === reach.hit;
  if (!same) lines.push(`${people(reach.hit)} hit this, ${plural(reach.participations, "time")} in all counting each execution separately.`, "");
  const scope = same ? `the ${people(reach.hit)} who hit this` : `those ${String(reach.participations)}`;
  if (reach.stillActive === 0) {
    lines.push(`Of ${scope}, none is still visiting an execution that is running, so there is nobody whose silence could be read either way.`);
  } else {
    // The visits belong to the ones who CAME BACK, not to every one who is still visiting. Read
    // "3 are still visiting — 1 visit between them" a reader takes three people to have returned
    // and made one visit each less two; what happened is that one of the three came back once and
    // the other two have not been seen since. `cameBack` is the number that sentence is about.
    const came =
      reach.cameBack === 0
        ? `${reach.stillActive === 1 ? "is" : "are"} still visiting, and ${reach.stillActive === 1 ? "has" : "have"} not been back since it was last reported`
        : reach.stillActive === 1
          ? `is still visiting, and has been back since it was last reported — ${plural(reach.visitsSince, "visit")} — without reporting it again`
          : `are still visiting; ${reach.cameBack} of them ${reach.cameBack === 1 ? "has" : "have"} been back since it was last reported — ${plural(reach.visitsSince, "visit")} between them — and none has reported it again`;
    lines.push(`Of ${scope}, ${reach.stillActive} ${came}.`);
  }
  lines.push(...silenceLines(reach));
  lines.push(
    "",
    "This is an absence, not a repair. Outcomes vary between executions by design, so silence here is not a claim about the product: whether anything changed is your call, and populace has not made it.",
  );
  return lines;
}

/**
 * The people whose silence says nothing, which is two separate claims and used to be one sentence.
 *
 * "Walked away over it" is always safe: a give-up retires the participation and nobody wakes it
 * again inside that execution. "And has not been brought back" is a SECOND claim, and it is false
 * the moment a sibling execution or a carry-forward deals that person in again — which is a thing
 * the study does on purpose (`ContinuedFrom.gaveUp`). So it is attached to `notBroughtBack`, the
 * number that excludes anybody who was given another look, and to nothing else.
 */
function silenceLines(reach: ProblemReach): string[] {
  const lines: string[] = [];
  if (reach.walkedAway > 0) {
    // "Walked away OVER IT" was a claim about a CAUSE, and populace has no datum for it. What the
    // row says is that the person gave up — `retiredReason: "gave-up"` — and it says nothing about
    // which of the things they met drove them off, or whether this problem was among them. So the
    // sentence says what the row says, and the part that actually matters for an absence is true
    // either way: nobody woke them again, so their silence is not evidence about anything.
    lines.push(
      "",
      `${reach.walkedAway} gave up on the product after hitting this, so ${reach.walkedAway === 1 ? "that person was" : "they were"} never woken again in the execution they gave up in, and ${reach.walkedAway === 1 ? "that silence says" : "their silence says"} nothing about it. populace cannot tell whether this problem is why they left.`,
    );
    if (reach.notBroughtBack > 0) lines.push(`This study has not brought ${reach.notBroughtBack === 1 ? "that person" : `${String(reach.notBroughtBack)} of them`} back since.`);
  }
  if (reach.stopped > 0) {
    lines.push("", `${reach.stopped} stopped visiting for another reason — a visit cap, a scale-down, or an execution that is paused or over — and so had no chance to hit it again.`);
  }
  if (reach.unknown > 0) {
    // Said out loud rather than left to make the arithmetic above fail to add up. A reporter whose
    // participant row has gone — an execution deleted, or a store rebuilt (ADR-0011) — is in none
    // of the buckets, and three numbers under a total they do not reach is the kind of thing that
    // makes a reader stop believing the rest.
    lines.push("", `populace no longer has a participant record for ${String(reach.unknown)} of them, so ${reach.unknown === 1 ? "that one is" : "those are"} in none of the counts above.`);
  }
  return lines;
}

/**
 * How many report cycles have gone by, with somebody visiting in them, since this was last
 * reported — and which window that last report was in, so the sentence can name it rather than
 * naming the window being published, which is by definition not where the last report was.
 *
 * Both are counted over the group (see `Work.group`).
 *
 * `last.ordinal` is also the identity of the absence: two publishes looking back at the same last
 * report are looking at the same news, which is what stops the comment being restated every cycle
 * (`FiledIssueQuietNoticeSchema`).
 */
interface Quiet {
  cycles: number;
  last: ReportWindow | undefined;
}

function quietFor(work: Work): Quiet {
  const visited = work.windows.filter((window) => window.visited);
  const last = [...visited].reverse().find((window) => window.findings.some((finding) => work.group.has(finding.signature)));
  return { cycles: visited.filter((window) => window.ordinal > (last?.ordinal ?? 0)).length, last };
}

/**
 * Who hit it and how hard — in TWO scopes, each named, because they are different numbers.
 *
 * Every number on the card is counted over the report window this publish is about
 * (`ProjectReadModel.publishable`), and the sentence above these lines names that one cycle. So the
 * running total cannot share a line with it: printed bare under "Reported again in report cycle 7",
 * a longitudinal study's lifetime count reads as what cycle 7 saw, which for a study on its
 * twentieth cycle is a number several times too big. A count that is right for a different stretch
 * of time than the sentence it sits under is a false claim and not a rounding error.
 */
function incidenceLines(work: Work, history: SignatureHistory): string[] {
  const card = work.problem.card;
  const now = thisCycle(work);
  const verdict = recheckWords(work);
  return [
    // BOTH halves of the fraction are the window's. The denominator used to be `card.peopleTotal`,
    // the roster of the whole execution — so a longitudinal study on its seventh cycle published
    // "1 of 12 people who went hit it" with a numerator counted over one cycle and a denominator
    // counted over the study's whole life. Nobody can read that as anything but a proportion, and
    // as a proportion it was simply false.
    `- In ${whereWords(work)}: ${now.people} of ${people(now.went)} who visited hit it, filing ${plural(now.reports, "report")} between them.`,
    `- Across ${studyWords(work)} so far: ${plural(history.reports, "report")} in total, in ${plural(history.seenIn.length, cycleWords(work, 1))}.`,
    // "As the people who hit it rated it" attributed one person's rating to all of them: the card's
    // severity is the worst any member finding carries, and five people calling something low with
    // one calling it critical is a cluster whose severity is critical.
    `- Severity, at the worst any of them rated it: **${card.severity}**. Re-check: ${verdict}.`,
  ];
}

/**
 * The verdict, in the same four words the rest of populace uses, and WHAT DECIDED IT.
 *
 * Two things were wrong with the sentence this replaces, and they were both claims. It spelled the
 * verdict out itself — `"did not recur on replay"`, `"confirmed on replay"` — while
 * `verdictWords` in `@populace/fix-prompt` is stated there to be the one definition of those
 * words, so an issue and the populace screen it links to gave two accounts of one event. And it
 * asserted a REPLAY for every verdict, including the two cases where no replay decided anything: a
 * `coverage-gap` is settled by asking the target again which tools it exposes, and a verdict can
 * be written when the replay never ran at all — the account was swept, the address could not be
 * reached, or there was nothing recorded to repeat. "confirmed on replay" over a tool-list diff is
 * populace citing an experiment it did not perform, in the body a developer decides what to change
 * from.
 *
 * So the method is named the way `standingOf` names it: off the kind, and off whether the
 * verification carries any replayed steps.
 */
function recheckWords(work: Work): string {
  const replay = work.problem.detail?.replay ?? null;
  const words = verdictWords(replay === null ? work.problem.card.verdict : replay.verdict);
  // No verification at all: `verdictWords(null)` is "not checked yet", which needs no method.
  if (replay === null) return words;
  if (work.problem.card.kind === "coverage-gap") {
    // The same test `methodOf` makes: a tool-list diff cannot come back inconclusive, so an
    // inconclusive verdict on a coverage gap is one nothing settled.
    return replay.verdict === "inconclusive" ? `${words}, and nothing re-checked it — there was nothing for populace to repeat` : `${words}, from asking the target again which tools it exposes rather than from a replay`;
  }
  return replay.replay.length === 0 ? `${words}, and nothing re-checked it — there was nothing for populace to repeat` : `${words} on replay`;
}

/**
 * What the window being published saw of this problem: reports, and the people behind them.
 *
 * Counted off the window's own reports and the GROUP's signatures rather than read off the card,
 * because the card is one cluster's and the state the sentence above it makes is the group's. Where
 * a ledger row has bridged two wordings, the report that came in this cycle can be under the other
 * one — and the card would then show zeroes under "reported again", which is the same kind of false
 * claim as a lifetime total under a sentence naming one cycle, in the other direction.
 *
 * `went` is the window's own too, and deliberately NOT `card.peopleTotal`: the card's roster is
 * every person the execution sent, and a longitudinal execution sends them over its whole life
 * while a cycle is an hour of it. It is the people whose visits touched this window
 * (`ReportWindow.visitors`), counted as people rather than as participants so that the numerator
 * and the denominator are the same unit as well as the same stretch of time.
 */
function thisCycle(work: Work): { reports: number; people: number; went: number } {
  const window = work.current;
  if (window === undefined) return { reports: 0, people: 0, went: 0 };
  const mine = window.findings.filter((finding) => work.group.has(finding.signature));
  const participants = new Map(work.rows.agents.map((agent) => [`${agent.runId}\u0000${agent.id}`, agent]));
  // The durable person behind each report: the participant row's own where the row is there, and
  // the derivation off the id where it is not, exactly as the read model does it.
  const personOf = (runId: string, agentId: string): string => participants.get(`${runId}\u0000${agentId}`)?.personId ?? personIdOfAgentId(agentId);
  const who = new Set(mine.map((finding) => personOf(finding.runId, finding.agentId)));
  const went = new Set(window.visitors.map((agentId) => personOf(window.runId, agentId)));
  // The people who reported it are people who went, whatever the visitor list says: a report
  // belongs to a visit, and a fraction whose top half is larger than its bottom half is the one
  // shape of this sentence nobody would believe.
  for (const person of who) went.add(person);
  return { reports: mine.length, people: who.size, went: went.size };
}

/**
 * Which report cycle, in the user's words. An execution's first cycle is just the execution — a
 * study reported once per execution, which is every ephemeral study on defaults, should not be told
 * about a mechanism it never uses.
 */
function windowWords(window: ReportWindow | undefined): string {
  if (window === undefined) return "this study";
  return window.cycle === 1 ? `execution ${window.seq}` : `report cycle ${window.cycle} of execution ${window.seq}`;
}

/**
 * WHICH study is talking, which nothing in a comment used to say.
 *
 * The ledger and the issue are per PROJECT, and a project holds several studies against several
 * targets — dev and qa are two targets in one project and never two projects (ADR-0035). So one
 * issue can carry comments from two studies, and a reader following it had no way to tell which
 * one had reported what, or that there were two.
 *
 * The name is the user's own words for it, quoted, and it goes in the sentences that make a claim
 * rather than in every line: the heading of each of the three states, and the two counting lines
 * whose scope it names.
 */
function studyWords(work: Work): string {
  return `the "${work.simulation.name}" study`;
}

/** Where a claim is being made about: one report window, of one named study. */
function whereWords(work: Work): string {
  return `${windowWords(work.current)} of ${studyWords(work)}`;
}

/**
 * "Execution" or "report cycle", inflected for `n`, according to whether this study HAS cycles.
 *
 * A study reported once per execution — every ephemeral study on defaults — has one window per
 * execution, and telling its reader about "the last 3 report cycles" names a mechanism that study
 * never used and that the product's own vocabulary reserves for the longitudinal case. It is the
 * same judgement `windowWords` makes for one window, made over the whole sequence: cycles are
 * being spoken of as soon as any execution has more than one window in it.
 */
function cycleWords(work: Work, n: number): string {
  const word = work.windows.every((window) => window.cycle === 1) ? "execution" : "report cycle";
  return n === 1 ? word : `${word}s`;
}

// ---- the event log ---------------------------------------------------------

/**
 * That populace wrote to somebody's repository, in five fields.
 *
 * It takes primitives and not the connection or a client outcome, deliberately: `EventSchema.payload`
 * is a free-form `JsonValue` with no per-type schema, so nothing structural stops a token or a raw
 * response body from ending up in the log. Keeping both out of the scope that appends is the only
 * protection there is (ADR-0040).
 */
async function recordIssue(work: Work, type: "issue.opened" | "issue.commented", issue: { number: number; url: string }, signatures: number): Promise<void> {
  await work.store.appendEvent({
    projectId: work.simulation.projectId,
    simulationId: work.simulation.id,
    runId: work.current?.runId ?? null,
    wakeId: null,
    type,
    payload: {
      repo: work.connection.repo,
      number: issue.number,
      url: issue.url,
      outcome: type === "issue.opened" ? "filed" : "commented",
      signatures,
    },
  });
}

/** The ledger row as a screen needs it: enough to name the issue and link to it, and nothing else. */
function viewOf(row: FiledIssue): PublishIssueResult["issue"] {
  return { repo: row.repo, number: row.number, url: row.url, filedAt: row.filedAt };
}
