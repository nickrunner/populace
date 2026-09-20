import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, usd, usd4 } from "../format.js";
import { Bar, Breadcrumb, Button, Card, Chip, Failed, Loading, Mono, PageHeader, Payload, Problem, Section, Stat, ToolName } from "../components/ui.jsx";

/**
 * "I just set this up — did I set it up right?"
 *
 * Who is going, what they will meet when they get there, what it will cost, and — the part
 * nothing else in the product shows — the actual system prompt one of them will be given, word
 * for word, rendered by the runner's own code rather than by a second copy of it.
 *
 * Cohorts are named here; people are not, except as the three sample names that prove the cast is
 * real before a penny is spent (SPEC §7.6).
 */
const OVERRIDE_WORDS: Record<string, string> = { spending: "spending limits", verification: "verification settings", model: "model" };

/** "spending limits", or "spending limits and the model", in the words the Settings screen uses. */
function listOf(blocks: readonly string[]): string {
  const words = blocks.map((block) => OVERRIDE_WORDS[block] ?? block);
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export function Preflight() {
  const { key, href } = useProject();
  const { key: simKey, simulation, href: simHref } = useSimulation();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const preflight = useQuery(q.preflight(key, simKey));

  const start = useMutation({
    mutationFn: () => api.startRun(key, simKey, {}),
    onSuccess: async () => {
      await queries.invalidateQueries();
      void navigate(simHref("live"));
    },
  });

  if (preflight.isPending) return <Loading what="what is about to happen" />;
  if (preflight.isError) return <Failed error={preflight.error} />;

  const view = preflight.data;
  const ready = view.blockers.length === 0;

  return (
    <>
      <PageHeader
        title="Before you send them"
        trail={<Breadcrumb items={[{ label: "Simulations", to: href() }, { label: simulation.name, to: simHref() }, { label: "Before you send them" }]} />}
        lede={`${people(view.totalPeople)} ${view.totalPeople === 1 ? "is" : "are"} about to visit ${view.target.name}. Nothing on this page spends anything.`}
      />

      {view.blockers.length > 0 ? (
        <Card className="p-4 mb-6 border-medium/40">
          <p className="t-body text-ink mb-2">Not yet.</p>
          <ul className="list-disc pl-5">
            {view.blockers.map((blocker, i) => (
              <li key={i} className="t-body text-ink-soft">
                {blocker}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-4 gap-6 mb-9 pb-8 border-b border-rule">
        <Stat label="People going" value={view.totalPeople} sub={`${view.cohorts.length} ${view.cohorts.length === 1 ? "cohort" : "cohorts"}`} />
        <Stat label="Visits planned" value={view.plannedVisits} sub={view.estimate.bounded ? "and then it stops" : "a round; nothing caps it but you"} />
        <Stat
          label="Expected cost"
          value={usd(view.estimate.expectedUsd)}
          sub={`${usd(view.estimate.lowUsd)}–${usd(view.estimate.highUsd)}, at ${usd4(view.estimate.perWakeUsd)} a visit`}
        />
        <Stat label="Tools they will meet" value={view.target.tools.length} sub={view.target.resets ? "the target can be put back" : "the target cannot be reset"} />
      </div>

      {view.simulation.overriding.length > 0 ? (
        <p className="t-body text-medium -mt-6 mb-9">
          This simulation carries its own {listOf(view.simulation.overriding)}, so what Settings says is not what this run is held to.
        </p>
      ) : null}

      <Section title="Who is going" sub="by cohort — nobody is picked out until they find something">
        <Card className="divide-y divide-rule">
          {view.cohorts.map((cohort) => (
            <div key={cohort.slug} className="p-3.5">
              <div className="flex items-baseline gap-3">
                <span className="t-body text-ink">{cohort.name}</span>
                <Mono className="text-[11px] text-ink-muted">{cohort.slug}</Mono>
                <span className="flex-1" />
                <span className="t-meta text-ink-muted tabular-nums">{people(cohort.people)}</span>
              </div>
              <div className="mt-2 mb-2 max-w-[420px]">
                <Bar value={cohort.people} of={Math.max(1, view.totalPeople)} />
              </div>
              <p className="t-meta text-ink-muted">
                {cohort.personaName}
                {cohort.sampleNames.length === 0 ? "" : ` · ${cohort.sampleNames.join(", ")}${cohort.people > cohort.sampleNames.length ? " and the rest" : ""}`}
              </p>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="What they will find when they get there" sub={view.target.name}>
        <Card className="p-4">
          {view.target.warnings.map((warning, i) => (
            <p key={i} className="t-body text-medium mb-2">
              {warning}
            </p>
          ))}
          {view.target.undescribed.length > 0 ? (
            <p className="t-body text-ink-soft mb-3">
              {view.target.undescribed.length === 1 ? "One tool has no description" : `${view.target.undescribed.length} tools have no description`}, so people will most likely never reach for{" "}
              {view.target.undescribed.length === 1 ? "it" : "them"}: {view.target.undescribed.join(", ")}.
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 gap-y-1.5">
            {view.target.tools.map((tool) => (
              <ToolName key={tool} name={tool} />
            ))}
          </p>
          {view.target.tools.length === 0 ? <p className="t-body text-ink-muted italic">The target did not answer with a tool list.</p> : null}
          {view.target.blocked.length > 0 ? (
            <div className="mt-4 border-t border-rule pt-3">
              <p className="t-body text-ink-soft mb-2">
                {view.target.blocked.length === 1 ? "One tool it exposes is off limits" : `${view.target.blocked.length} tools it exposes are off limits`}, so whatever they are for will go
                untested. This is what a tool policy does; it is here so a typo'd glob is not discovered as a silence in the digest tomorrow.
              </p>
              <ul className="divide-y divide-rule border-t border-rule">
                {view.target.blocked.map((tool) => (
                  <li key={tool.name} className="py-2 flex items-baseline gap-3">
                    <span className="line-through opacity-50">
                      <ToolName name={tool.name} />
                    </span>
                    <span className="t-meta text-ink-muted flex-1">{tool.why}</span>
                    <span className="t-meta text-ink-muted">blocked for {tool.who}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="t-meta text-ink-muted mt-3">
            {view.target.destructive === "deny"
              ? "Nobody may use a tool the target marks destructive."
              : view.target.destructive === "allow"
                ? "Tools the target marks destructive go through without a second thought."
                : "A tool the target marks destructive takes two identical calls: the first comes back asking whether they meant it."}
          </p>
          <p className="t-meta text-ink-muted mt-3">
            {view.target.resets
              ? "This target can be put back the way it was between executions, so an ephemeral run really is a clean slate on both sides."
              : "This target declares no way to be put back, so a clean slate means fresh people, memory and accounts — not fresh data on the server."}
          </p>
        </Card>
      </Section>

      <Section title="What one of them will actually be told" sub={`${view.promptPreview.personName || "a person"} · ${view.promptPreview.cohortSlug}`}>
        <Payload>{view.promptPreview.text}</Payload>
        <p className="t-meta text-ink-muted mt-2">
          Rendered by the same code that builds it at run time. Their memory and their account arrive in the first message of each visit, after this.
        </p>
      </Section>

      {start.isError ? <Problem>{start.error.message}</Problem> : null}

      <Card className="p-4 flex items-center gap-4">
        <p className="t-body text-ink-soft flex-1">
          {view.simulation.mode === "ephemeral"
            ? "Everyone arrives remembering nothing and stops when their visits are used up. Run it again later and it starts over — different people will try different things, so expect the numbers to move even when nothing has changed."
            : "They keep coming back, building on what they remember, until you pause it."}
        </p>
        {view.simulation.status === "running" ? <Chip tone="live">already running</Chip> : null}
        <Button tone="go" onClick={() => start.mutate()} disabled={!ready || start.isPending || view.simulation.status === "running"}>
          {start.isPending ? "Starting…" : "Send them in"}
        </Button>
      </Card>
    </>
  );
}
