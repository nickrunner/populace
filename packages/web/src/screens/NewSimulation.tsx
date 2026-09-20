import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people as peopleWord, usd, usd4 } from "../format.js";
import { Breadcrumb, Button, Card, Field, Input, Loading, Mono, NumberInput, PageHeader, Problem, Section } from "../components/ui.jsx";

/**
 * Four decisions on one page: what it is called, how it runs, who goes, and where they go
 * (SPEC §7.6). The mode is two cards rather than a dropdown because it is the only choice here
 * that changes what the results mean.
 */
export function NewSimulation() {
  const { key, project, href } = useProject();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const populations = useQuery(q.populations(key));
  const targets = useQuery(q.targets(key));

  const [name, setName] = useState("");
  const [bounded, setBounded] = useState(true);
  const [visits, setVisits] = useState(4);
  const [populationId, setPopulationId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  // The per-visit price is history over this machine's own visits and has nothing to do with which
  // population goes, so an existing simulation's estimate is the right source for a simulation
  // that does not exist yet. Without one, the arithmetic is honest about being only a headcount.
  const priced = project.simulations[0];
  const estimate = useQuery({ ...q.estimate(key, priced?.slug ?? ""), enabled: priced !== undefined });

  const create = useMutation({
    mutationFn: () =>
      api.createSimulation(key, {
        name: name.trim(),
        visitsPerPerson: bounded ? visits : null,
        ...(populationId === null ? {} : { populationId }),
        ...(targetId === null ? {} : { targetId }),
      }),
    onSuccess: async (simulation) => {
      await queries.invalidateQueries();
      void navigate(`${href()}/s/${encodeURIComponent(simulation.slug)}/preflight`);
    },
  });

  if (populations.isPending || targets.isPending) return <Loading what="what you have to run" />;

  const pops = populations.data?.items ?? [];
  const tgts = targets.data?.items ?? [];
  const population = pops.find((p) => p.id === populationId) ?? pops[0];
  const headcount = population === undefined ? 0 : population.members.reduce((sum, m) => sum + m.count, 0);
  const plannedVisits = bounded ? headcount * visits : headcount;
  const perVisit = estimate.data?.perWakeUsd;

  return (
    <>
      <PageHeader
        title="New simulation"
        trail={<Breadcrumb items={[{ label: "Simulations", to: href() }, { label: "New simulation" }]} />}
        lede="A simulation is a population, a target, and a way of running them. Everything here can be changed afterwards; only starting it spends anything."
      />

      <Section title="What to call it">
        <Card className="p-4">
          <Field label="Name" hint="What you will look for in the list. “Smoke: first-timers”, “Long haul”, “Mobile only”.">
            <Input value={name} onChange={setName} placeholder="Smoke: first-timers" />
          </Field>
        </Card>
      </Section>

      <Section title="How it runs" sub="the one choice here that changes what the results mean">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setBounded(true)} className={`text-left p-4 rounded-lg border ${bounded ? "border-accent bg-accent-wash" : "border-rule bg-card hover:border-rule-strong"}`}>
            <div className="t-label text-ink-muted mb-1">EPHEMERAL</div>
            <div className="t-body font-medium text-ink">A clean slate, and an end</div>
            <p className="t-body text-ink-soft mt-1">
              Everyone arrives remembering nothing, makes a set number of visits, and is finished. Run it again after a fix and the two executions are independent of each other.
            </p>
            <p className="t-meta text-ink-muted mt-2">
              Two executions will not agree exactly — different people try different things — so what is compared between them is which problems came back, not the numbers.
            </p>
          </button>
          <button type="button" onClick={() => setBounded(false)} className={`text-left p-4 rounded-lg border ${!bounded ? "border-accent bg-accent-wash" : "border-rule bg-card hover:border-rule-strong"}`}>
            <div className="t-label text-ink-muted mb-1">LONGITUDINAL</div>
            <div className="t-body font-medium text-ink">They keep coming back</div>
            <p className="t-body text-ink-soft mt-1">
              Memory accumulates: someone who was annoyed on visit two is still annoyed on visit nine. It has no end — you pause it, and it picks back up where it stopped.
            </p>
            <p className="t-meta text-ink-muted mt-2">This is the one that finds what only shows up after a week of use.</p>
          </button>
        </div>
        {bounded ? (
          <Card className="p-4 mt-3">
            <Field label="Visits each" hint="How many times each person comes back before they are done.">
              <div className="w-32">
                <NumberInput value={visits} onChange={setVisits} min={1} />
              </div>
            </Field>
          </Card>
        ) : null}
      </Section>

      <Section title="Who goes">
        <Card className="divide-y divide-rule">
          {pops.map((option) => {
            const people = option.members.reduce((sum, m) => sum + m.count, 0);
            const chosen = (populationId ?? pops[0]?.id) === option.id;
            return (
              <label key={option.id} className="p-3.5 flex items-center gap-3 cursor-pointer">
                <input type="radio" name="population" checked={chosen} onChange={() => setPopulationId(option.id)} />
                <span className="flex-1 min-w-0">
                  <span className="t-body text-ink block">{option.name}</span>
                  <span className="t-meta text-ink-muted">
                    {peopleWord(people)} · {option.members.length} {option.members.length === 1 ? "cohort" : "cohorts"}
                  </span>
                </span>
              </label>
            );
          })}
        </Card>
      </Section>

      <Section title="Where they go">
        <Card className="divide-y divide-rule">
          {tgts.map((option) => {
            const chosen = (targetId ?? tgts[0]?.id) === option.id;
            return (
              <label key={option.id} className="p-3.5 flex items-center gap-3 cursor-pointer">
                <input type="radio" name="target" checked={chosen} onChange={() => setTargetId(option.id)} />
                <span className="flex-1 min-w-0">
                  <span className="t-body text-ink block">{option.name}</span>
                  <Mono className="text-[11px] text-ink-muted block break-all">{option.mcp[0]?.url}</Mono>
                </span>
              </label>
            );
          })}
        </Card>
        <p className="t-meta text-ink-muted mt-2">
          Whether it answers, and whether it can be put back the way it was, is checked on “Before you send them” — asking costs a connection to somebody else's server.
        </p>
      </Section>

      {create.isError ? <Problem>{create.error.message}</Problem> : null}

      <Card className="p-4 flex items-center gap-4">
        <p className="t-body text-ink-soft flex-1">
          {peopleWord(headcount)} ×{" "}
          {bounded ? (
            <>
              {visits} visits = <span className="tabular-nums">{plannedVisits}</span> visits
            </>
          ) : (
            "as many visits as it takes"
          )}
          {perVisit === undefined ? (
            <> · nothing has run here yet, so there is no price to work from.</>
          ) : bounded ? (
            <>
              {" "}
              · about <span className="tabular-nums">{usd(perVisit * plannedVisits)}</span>, at {usd4(perVisit)} a visit
              {estimate.data?.basis === "history" ? ` from your last ${estimate.data.sampleSize} visits.` : " from a default."}
            </>
          ) : (
            <>
              {" "}
              · about <span className="tabular-nums">{usd(perVisit * headcount)}</span> a round, at {usd4(perVisit)} a visit. Nothing caps it but you.
            </>
          )}
        </p>
        <Button tone="go" onClick={() => create.mutate()} disabled={create.isPending || name.trim() === ""}>
          {create.isPending ? "Making it…" : "Make it"}
        </Button>
      </Card>
    </>
  );
}
