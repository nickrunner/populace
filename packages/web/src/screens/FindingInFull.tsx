import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { Cluster, Finding } from "../api.js";
import { clusterVerdict, inTheirWords, ms, usd4, when } from "../format.js";
import { Avatar, CallRef, Card, Failed, Loading, Mono, Payload, Severity, ToolName, Verdict } from "../components/ui.jsx";

/**
 * The screen where the two audiences meet. Left: her words and what it cost, in prose. Right: the
 * calls that produced it and the replay verdict, in monospace. Neither is behind a mode.
 */
function Steps({ finding, runId, who }: { finding: Finding; runId: string; who: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="t-label text-ink-muted">{who} · the calls behind this</div>
        <Link to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(finding.wakeId)}`} className="t-meta text-accent hover:underline">
          open the full visit
        </Link>
      </div>
      <ol className="flex flex-col gap-2.5">
        {finding.reproduction.map((step) => (
          <li key={step.ref}>
            <div className="flex items-baseline gap-2 mb-1">
              <CallRef>{step.ref}</CallRef>
              <Mono className="text-[12px] text-ink">
                {step.tool}({JSON.stringify(step.arguments)})
              </Mono>
              <span className="t-meta text-ink-muted ml-auto shrink-0">{ms(step.latencyMs)}</span>
            </div>
            <Payload>
              <span className={step.result.isError ? "text-critical" : "text-ink-soft"}>→ {step.result.text.slice(0, 600)}</span>
            </Payload>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Replay({ cluster }: { cluster: Cluster }) {
  const verification = cluster.representative.verification;
  if (!verification) {
    return (
      <Card className="p-4">
        <div className="t-label text-ink-muted mb-1.5">We have not replayed this yet</div>
        <p className="t-body text-ink-soft">
          Run <Mono className="text-[12.5px]">populace digest</Mono> to have the verifier replay these calls and rule on them.
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span className="t-label text-ink-muted">We ran those calls again ourselves</span>
        <Verdict value={verification.verdict} />
      </div>
      <p className="t-body text-ink-soft">{verification.reason}</p>
      <div className="t-meta text-ink-muted mt-2.5 font-mono">
        {verification.judge} judge · {when(verification.verifiedAt)} · {usd4(verification.costUsd)}
      </div>
    </Card>
  );
}

export function FindingInFull({ runId }: { runId: string }) {
  const { clusterId } = useParams();
  const digest = useQuery({ queryKey: ["digest", runId], queryFn: () => api.digest(runId) });
  const agents = useQuery({ queryKey: ["agents", runId], queryFn: () => api.agents(runId) });

  if (digest.isError) return <Failed error={digest.error} />;
  const digestData = digest.data;
  const agentData = agents.data;
  if (!digestData || !agentData) return <Loading what="this finding" />;

  const cluster = digestData.clusters.find((c) => c.id === clusterId);
  if (!cluster) return <Failed error={new Error(`no finding ${clusterId ?? ""} in this run`)} />;

  const nameOf = (personaId: string): string => agentData.items.find((a) => a.personaId === personaId)?.personaName ?? personaId;
  const people = agentData.items.length;
  const representative = cluster.representative;
  const others = cluster.findings.filter((f) => f.id !== representative.id);

  return (
    <>
      <div className="t-meta text-ink-muted mb-2">
        <Link to={`/runs/${encodeURIComponent(runId)}/findings`} className="text-accent hover:underline">
          Findings
        </Link>
      </div>

      <div className="flex items-center gap-2.5 mb-2">
        <Severity value={cluster.severity} kind={cluster.kind} />
        {cluster.tool ? <ToolName name={cluster.tool} missing={cluster.kind === "coverage-gap"} /> : null}
      </div>
      <h1 className="t-title mb-2.5 max-w-[46ch]">{cluster.title}</h1>
      <div className="flex flex-wrap items-center gap-4 t-meta text-ink-muted mb-8 pb-6 border-b border-rule">
        <span>
          {cluster.personaIds.length} of {people} {people === 1 ? "person" : "people"}
        </span>
        <span>
          {cluster.findings.length} {cluster.findings.length === 1 ? "report" : "reports"}
        </span>
        <Verdict value={clusterVerdict(cluster)} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 items-start">
        <div>
          <h2 className="t-section mb-3">In their own words</h2>
          <div className="flex flex-col gap-4 mb-8">
            {cluster.findings.map((finding) => (
              <div key={finding.id} className="flex gap-3">
                <Avatar name={nameOf(finding.personaId)} />
                <div className="min-w-0">
                  <p className="t-body text-ink italic">“{inTheirWords(finding)}”</p>
                  <div className="t-meta text-ink-muted mt-1">
                    {nameOf(finding.personaId)} ·{" "}
                    <Link to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(finding.wakeId)}`} className="text-accent hover:underline">
                      watch this visit
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h2 className="t-section mb-2">They expected</h2>
          <p className="t-body text-ink-soft mb-5">{representative.expected}</p>
          <h2 className="t-section mb-2">What happened</h2>
          <p className="t-body text-ink-soft">{representative.observed}</p>
        </div>

        <div className="flex flex-col gap-4">
          <Steps finding={representative} runId={runId} who={nameOf(representative.personaId)} />
          <Replay cluster={cluster} />
          {others.length > 0 ? (
            <Card className="p-4">
              <div className="t-label text-ink-muted mb-2.5">Also reported by</div>
              <div className="flex flex-col gap-2">
                {others.map((finding) => (
                  <div key={finding.id} className="flex items-center gap-2.5">
                    <Avatar name={nameOf(finding.personaId)} />
                    <span className="t-body">{nameOf(finding.personaId)}</span>
                    <Link
                      to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(finding.wakeId)}`}
                      className="t-meta text-accent hover:underline ml-auto"
                    >
                      their calls
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
