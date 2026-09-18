import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { Digest, Participant, Run } from "../api.js";
import { usd, when } from "../format.js";
import { ClusterRow } from "../components/ClusterRow.jsx";
import { Avatar, Card, Failed, Loading, PageHeader, Section, Stat } from "../components/ui.jsx";

/**
 * The one sentence at the top is the whole report for someone who reads nothing else, so it is
 * assembled from what happened rather than from a template with numbers dropped in.
 */
function headline(run: Run, people_: Participant[], targetName: string): string {
  const people = people_.length;
  const left = people_.filter((a) => a.retiredReason === "gave-up");
  const struggled = new Set(run.findingsByKind.bug > 0 || run.findingsByKind.friction > 0 ? people_.filter((a) => a.findings > 0).map((a) => a.id) : []);
  if (people === 0) return `Nobody has visited ${targetName} in this run yet.`;
  if (struggled.size === 0 && left.length === 0) return `All ${people} ${people === 1 ? "person" : "people"} we sent to ${targetName} got their errands done without filing anything.`;

  const count = struggled.size === people ? `All ${people}` : `${struggled.size} of the ${people}`;
  const noun = struggled.size === 1 ? "person" : "people";
  const tail =
    left.length === 0
      ? ", though nobody left"
      : left.length === 1
        ? `, and ${left[0]?.personaName.split(" ")[0] ?? "one of them"} left`
        : `, and ${left.length} of them left`;
  return `${count} ${noun} we sent to ${targetName} hit something that got in their way${tail}.`;
}

function worstFirst(digest: Digest) {
  return digest.clusters.filter((c) => c.kind !== "praise").slice(0, 4);
}

export function Overview({ runId }: { runId: string }) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId) });
  const participants = useQuery({ queryKey: ["participants", runId], queryFn: () => api.participants(runId) });
  const digest = useQuery({ queryKey: ["digest", runId], queryFn: () => api.digest(runId) });
  const spend = useQuery({ queryKey: ["spend", runId], queryFn: () => api.spend(runId) });
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });

  if (run.isError) return <Failed error={run.error} />;
  const runData = run.data;
  const participantData = participants.data;
  const digestData = digest.data;
  if (!runData || !participantData || !digestData) return <Loading what="this run" />;

  const people = participantData.items;
  const left = people.filter((a) => a.retiredReason === "gave-up");
  const finished = runData.wakesByStatus.done;

  return (
    <>
      <PageHeader
        title={targets.data?.items[0]?.name ?? runData.populationId}
        trail={
          <>
            {runData.startedAt ? when(runData.startedAt) : "not started"} · {people.length} {people.length === 1 ? "person" : "people"} ·{" "}
            {runData.totals.wakes} {runData.totals.wakes === 1 ? "visit" : "visits"}
          </>
        }
      />

      <p className="t-display mb-8 max-w-[34ch] leading-[1.25]">{headline(runData, people, targets.data?.items[0]?.name ?? "the target")}</p>

      <div className="grid grid-cols-4 gap-6 mb-10 pb-8 border-b border-rule">
        <Stat label="Errands finished" value={`${finished} of ${runData.totals.wakes}`} />
        <Stat
          label="Problems confirmed"
          value={`${runData.verified.confirmed} of ${runData.verified.checked}`}
          sub={runData.verified.checked === 0 ? "nothing checked yet" : "checked"}
        />
        <Stat
          label="Walked away"
          value={left.length}
          sub={left[0] ? `${left[0].personaName.split(" ")[0]}, at visit ${left[0].visits}` : "nobody, so far"}
        />
        <Stat label="Spent on this run" value={usd(spend.data?.totalUsd ?? runData.totals.costUsd)} />
      </div>

      <Section title="What is wrong" sub={`${digestData.clusters.length} things, worst first`}>
        <div className="flex flex-col gap-3">
          {worstFirst(digestData).map((cluster) => (
            <ClusterRow key={cluster.id} cluster={cluster} runId={runId} people={people.length} />
          ))}
          {digestData.clusters.length === 0 ? <p className="t-body text-ink-muted italic">Nobody has filed anything yet.</p> : null}
        </div>
        {digestData.clusters.length > 4 ? (
          <Link to={`/runs/${encodeURIComponent(runId)}/findings`} className="inline-block mt-3 t-body text-accent hover:underline">
            All {runData.totals.findings} findings
          </Link>
        ) : null}
      </Section>

      <Section title="Who we sent">
        <div className="grid grid-cols-3 gap-3">
          {people.map((agent) => (
            <Card key={agent.id} className="p-3.5">
              <div className="flex items-center gap-2.5 mb-2">
                <Avatar name={agent.personaName} />
                <div className="min-w-0">
                  <div className="t-body font-medium truncate">{agent.personaName}</div>
                  <div className="t-meta text-ink-muted truncate">{agent.role}</div>
                </div>
              </div>
              <div className="t-meta text-ink-muted">
                {agent.visits} {agent.visits === 1 ? "visit" : "visits"} · {agent.findings} filed
              </div>
              <div className={`t-meta mt-1 ${agent.retiredReason === "gave-up" ? "text-critical" : "text-confirmed"}`}>
                {agent.retiredReason === "gave-up" ? `Left at visit ${agent.visits}` : agent.status === "active" ? "Still coming back" : "Done for now"}
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
