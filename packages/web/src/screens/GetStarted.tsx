import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type TargetCheck } from "../api.js";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people as peopleWord, usd, usd4 } from "../format.js";
import { Button, Card, Chip, Input, NumberInput, Problem, Stepper, ToolName } from "../components/ui.jsx";

/**
 * The zero state, and the only path into a first run (SPEC §7.5).
 *
 * It is a card on project home rather than a mode the product puts you in: nothing here is a
 * wizard you have to finish before the rest of the product exists, and every step is also
 * somewhere in the library. A step opens when the one above it is satisfied, and collapses to a
 * line when it is done — so the page reads as "what is left" rather than as a form.
 *
 * Behind it, step 2 creates personas and cohorts and step 3 names the simulation. The user never
 * sees those words until they need them.
 */
export function GetStarted() {
  const { project, href } = useProject();
  const done = { target: project.counts.targets > 0, people: project.counts.people > 0 };

  return (
    <Card className="mb-9">
      <div className="p-5 border-b border-rule">
        <h2 className="t-section">Get started</h2>
        <p className="t-body text-ink-soft mt-1 max-w-[68ch]">
          Three things, and then people start visiting {project.name}. Nothing spends money until the last one.
        </p>
      </div>
      <Step n={1} title="Point at your app" open={!done.target} done={done.target} summary={<TargetSummary />}>
        <ConnectStep />
      </Step>
      <Step n={2} title="Pick who visits it" open={done.target && !done.people} done={done.people} summary={`${project.counts.people} people across ${project.counts.cohorts} ${project.counts.cohorts === 1 ? "kind" : "kinds"} of person`}>
        <PickStep />
      </Step>
      <Step n={3} title="Send them in" open={done.target && done.people} done={false} summary="">
        {done.target && done.people ? <RunStep /> : <p className="t-body text-ink-muted px-5 pb-5">Pick who goes first.</p>}
      </Step>
      <div className="px-5 py-3 border-t border-rule">
        <Link to={href("library/personas")} className="t-meta text-accent hover:underline">
          Or write your own person from scratch →
        </Link>
        <span className="t-meta text-ink-muted"> · everything above is in the library afterwards, and nothing here is permanent.</span>
      </div>
    </Card>
  );
}

function Step({ n, title, open, done, summary, children }: { n: number; title: string; open: boolean; done: boolean; summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`border-b border-rule last:border-0 ${open ? "" : "opacity-95"}`}>
      <div className="flex items-baseline gap-3 px-5 pt-4">
        <span className={`t-label tabular-nums ${done ? "text-confirmed" : open ? "text-accent" : "text-ink-muted"}`}>{done ? "✓" : n}</span>
        <h3 className={`t-body font-medium ${open || done ? "text-ink" : "text-ink-muted"}`}>{title}</h3>
        {done ? <span className="t-meta text-ink-muted">{summary}</span> : null}
      </div>
      {open ? <div className="px-5 pb-5 pt-3">{children}</div> : <div className="pb-4" />}
    </section>
  );
}

function TargetSummary() {
  const { key } = useProject();
  const targets = useQuery(q.targets(key));
  const target = targets.data?.items[0];
  return target === undefined ? null : (
    <>
      {target.name} · <span className="font-mono text-[11.5px]">{target.mcp[0]?.url}</span>
    </>
  );
}

/** Step 1. One address and one button; what comes back is the tool list, which is the answer. */
function ConnectStep() {
  const { key } = useProject();
  const queries = useQueryClient();
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<TargetCheck | null>(null);

  const connect = useMutation({
    mutationFn: async () => {
      const result = await api.checkDraftTarget(key, { mcp: [{ name: "default", url }] });
      setCheck(result);
      if (!result.ok) return null;
      // A check that succeeded IS the connection: the tool list is what the identity fields are
      // guessed from, and guessing them here saves a form nobody can fill in before they have it.
      return api.saveTarget(key, null, {
        name: result.server?.name || new URL(url).host,
        mcp: [{ name: "default", url }],
        identity:
          result.identity.signupTool === null
            ? { strategy: "self-signup", signupTool: "", tokenPath: "token", emailDomain: "populace.test" }
            : {
                strategy: "self-signup",
                signupTool: result.identity.signupTool,
                tokenPath: result.identity.tokenPath ?? "token",
                ...(result.identity.userIdPath === null ? {} : { userIdPath: result.identity.userIdPath }),
                ...(result.identity.teardownTool === null ? {} : { teardownTool: result.identity.teardownTool }),
                emailDomain: "populace.test",
              },
      });
    },
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  return (
    <div>
      <div className="flex items-end gap-2 max-w-[560px]">
        <div className="flex-1">
          <span className="t-label text-ink-muted block mb-1.5">Its MCP address</span>
          <Input value={url} onChange={setUrl} placeholder="http://127.0.0.1:4310/mcp" mono />
        </div>
        <Button tone="go" onClick={() => connect.mutate()} disabled={connect.isPending || url === ""}>
          {connect.isPending ? "Checking…" : "Check"}
        </Button>
      </div>
      {connect.isError ? <Problem>{connect.error.message}</Problem> : null}
      {check === null ? null : check.ok ? (
        <div className="mt-3">
          <p className="t-body text-ink">
            <span className="text-confirmed">✓</span> {check.tools.length} tools
            {check.identity.signupTool === null ? " · nothing here looks like a sign-up, so nobody will have an account" : <> · they sign up with <ToolName name={check.identity.signupTool} /></>}
          </p>
          {check.undescribed.length > 0 ? (
            <p className="t-meta text-ink-muted mt-1">
              {check.undescribed.length} of them have no description. People decide what to try from descriptions alone, so those will most likely never be touched.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <p className="t-body text-critical">Could not reach it.</p>
          {check.errors.map((error, i) => (
            <p key={i} className="t-meta text-ink-muted font-mono mt-1">
              {error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Step 2. Six people who find different things; tick two or three and say how many of each. */
function PickStep() {
  const { key } = useProject();
  const queries = useQueryClient();
  const starters = useQuery(q.starters(key));
  const [picked, setPicked] = useState<Record<string, number>>({});

  const add = useMutation({
    mutationFn: async () => {
      for (const [slug, count] of Object.entries(picked)) await api.addStarter(key, slug, count);
    },
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  const total = Object.values(picked).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <ul className="divide-y divide-rule border-y border-rule mb-4">
        {(starters.data?.items ?? []).map((starter) => {
          const count = picked[starter.slug];
          return (
            <li key={starter.slug} className="py-2.5 flex items-center gap-3">
              <input
                type="checkbox"
                checked={count !== undefined}
                onChange={() =>
                  setPicked((current) =>
                    starter.slug in current
                      ? Object.fromEntries(Object.entries(current).filter(([slug]) => slug !== starter.slug))
                      : { ...current, [starter.slug]: 1 },
                  )
                }
                aria-label={starter.name}
              />
              <div className="flex-1 min-w-0">
                <div className="t-body text-ink">
                  {starter.name} <span className="text-ink-muted">· {starter.role}</span>
                </div>
                <div className="t-meta text-ink-muted">{starter.summary}</div>
              </div>
              {count === undefined ? null : <Stepper value={count} onChange={(v) => setPicked((p) => ({ ...p, [starter.slug]: v }))} />}
            </li>
          );
        })}
      </ul>
      {add.isError ? <Problem>{add.error.message}</Problem> : null}
      <div className="flex items-center gap-3">
        <Button tone="go" onClick={() => add.mutate()} disabled={add.isPending || total === 0}>
          {add.isPending ? "Writing them…" : total === 0 ? "Tick someone" : `Take these ${peopleWord(total)}`}
        </Button>
        <span className="t-meta text-ink-muted">Each of them gets a name and a life of their own, and they keep it between runs.</span>
      </div>
    </div>
  );
}

/** Step 3. The mode, what it will cost, and the one button on this page that spends anything. */
function RunStep() {
  const { key, href } = useProject();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const setup = useQuery(q.setup(key));
  const simulationId = setup.data?.simulationIds[0]?.id ?? "";
  const estimate = useQuery({ ...q.estimate(key, simulationId), enabled: simulationId !== "" });
  const [name, setName] = useState("First look");
  const [visits, setVisits] = useState(4);
  const [bounded, setBounded] = useState(true);

  const go = useMutation({
    mutationFn: async () => {
      const simulation = await api.saveSimulation(key, simulationId, { name: name.trim() || "First look", visitsPerPerson: bounded ? visits : null });
      const started = await api.startRun(key, simulation.slug, {});
      return { slug: simulation.slug, runId: started.runId };
    },
    onSuccess: async (started) => {
      await queries.invalidateQueries();
      void navigate(`${href()}/s/${encodeURIComponent(started.slug)}/live`);
    },
  });

  const blockers = setup.data?.blockers ?? [];
  const stopped = setup.data?.killSwitch.engaged ?? false;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button type="button" onClick={() => setBounded(true)} className={`text-left p-3.5 rounded-md border ${bounded ? "border-accent bg-accent-wash" : "border-rule bg-card hover:border-rule-strong"}`}>
          <div className="t-body font-medium text-ink">A few visits each, then stop</div>
          <p className="t-meta text-ink-muted mt-1">
            Everyone arrives knowing nothing, makes a set number of visits and is finished. Run it again after a fix and the two runs are independent.
          </p>
        </button>
        <button type="button" onClick={() => setBounded(false)} className={`text-left p-3.5 rounded-md border ${!bounded ? "border-accent bg-accent-wash" : "border-rule bg-card hover:border-rule-strong"}`}>
          <div className="t-body font-medium text-ink">Keep coming back until I stop it</div>
          <p className="t-meta text-ink-muted mt-1">People remember what happened last time and build on it. It runs until you pause it, and it can be picked back up.</p>
        </button>
      </div>

      <div className="flex items-end gap-4 mb-4">
        <div className="flex-1 max-w-[320px]">
          <span className="t-label text-ink-muted block mb-1.5">Call it</span>
          <Input value={name} onChange={setName} placeholder="First look" />
        </div>
        {bounded ? (
          <div className="w-32">
            <span className="t-label text-ink-muted block mb-1.5">Visits each</span>
            <NumberInput value={visits} onChange={setVisits} min={1} />
          </div>
        ) : null}
      </div>

      {estimate.data ? (
        <p className="t-body text-ink-soft mb-3">
          {peopleWord(estimate.data.agents)} × {bounded ? `${visits} visits` : `${estimate.data.assumedWakesPerAgent} visits each, assumed`} ={" "}
          <span className="tabular-nums">{bounded ? estimate.data.agents * visits : estimate.data.visits}</span> visits, about{" "}
          <span className="tabular-nums">{usd(bounded ? estimate.data.perWakeUsd * estimate.data.agents * visits : estimate.data.expectedUsd)}</span> at {usd4(estimate.data.perWakeUsd)} a visit
          {estimate.data.basis === "history" ? ` — from what a visit actually cost on your last ${estimate.data.sampleSize}.` : " — from a default, because nothing has run here yet."}
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="mb-3">
          {blockers.map((blocker, i) => (
            <li key={i} className="t-body text-medium">
              {blocker}
            </li>
          ))}
        </ul>
      ) : null}
      {go.isError ? <Problem>{go.error.message}</Problem> : null}

      <div className="flex items-center gap-3">
        <Button tone="go" onClick={() => go.mutate()} disabled={go.isPending || simulationId === "" || blockers.length > 0}>
          {go.isPending ? "Starting…" : "Send them in"}
        </Button>
        {stopped ? <Chip tone="bad">everything is stopped</Chip> : null}
        {simulationId === "" ? null : (
          <Link to={`${href()}/s/${encodeURIComponent(setup.data?.simulationIds[0]?.slug ?? "")}/preflight`} className="t-meta text-accent hover:underline">
            Before you send them →
          </Link>
        )}
      </div>
    </div>
  );
}
