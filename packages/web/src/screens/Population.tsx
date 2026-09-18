import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { Agent } from "../api.js";
import { clock, usd } from "../format.js";
import { Avatar, Card, Failed, Loading, Mono, PageHeader } from "../components/ui.jsx";

/**
 * Memory is keyed by run and agent (ADR-0020), so this panel is empty on a fresh run and is the
 * whole story by the third visit. It is what makes "she came back and she is still annoyed"
 * something you can see rather than something you have to take on trust.
 */
function Carrying({ runId, agent }: { runId: string; agent: Agent }) {
  const memory = useQuery({ queryKey: ["memory", runId, agent.id], queryFn: () => api.memory(runId, agent.id) });
  if (memory.isPending) return <p className="t-meta text-ink-muted">Reading her notes…</p>;
  if (memory.isError) return <p className="t-meta text-ink-muted">Could not read this agent's memory.</p>;

  const groups = [
    { label: "Waiting on", entries: memory.data.waitingOn },
    { label: "What annoyed them", entries: memory.data.annoyances },
    { label: "Already done", entries: memory.data.done },
  ].filter((group) => group.entries.length > 0);

  if (groups.length === 0) {
    return <p className="t-meta text-ink-muted italic">Nothing yet. This fills in as they come back.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="t-label text-ink-muted mb-1">{group.label}</div>
          <ul className="flex flex-col gap-1">
            {group.entries.slice(0, 4).map((entry, index) => (
              <li key={`${entry.wake}-${index}`} className="t-body text-ink-soft flex gap-2">
                <span className="flex-1">{entry.text}</span>
                <span className="t-meta text-ink-muted shrink-0">visit {entry.wake}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Population({ runId }: { runId: string }) {
  const agents = useQuery({ queryKey: ["agents", runId], queryFn: () => api.agents(runId) });
  if (agents.isError) return <Failed error={agents.error} />;
  if (agents.isPending) return <Loading what="the population" />;

  return (
    <>
      <PageHeader
        title="Population"
        lede="The people we sent, grown from your personas, each on their own schedule. Everything they remember between visits is here — it is what makes the fourth visit different from the first."
      />

      <div className="flex flex-col gap-4">
        {agents.data.items.map((agent) => (
          <Card key={agent.id} className="p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Avatar name={agent.personaName} />
                  <div className="min-w-0">
                    <div className="t-finding">{agent.personaName}</div>
                    <Mono className="text-[11px] text-ink-muted">{agent.id}</Mono>
                  </div>
                  {agent.retiredReason === "gave-up" ? (
                    <span className="ml-auto t-meta text-critical shrink-0">
                      left at visit {agent.wakeCount}
                      {agent.wouldReturn === true ? " · said she would come back" : ""}
                    </span>
                  ) : (
                    <span className="ml-auto t-meta text-confirmed shrink-0">{agent.status === "active" ? "still coming back" : "done for now"}</span>
                  )}
                </div>

                <p className="t-body text-ink-soft mb-3 max-w-[70ch]">{agent.backstory}</p>

                <div className="flex flex-wrap gap-x-5 gap-y-1 t-meta text-ink-muted">
                  <span>patience {agent.patience} of 5</span>
                  <span>would pay {usd(agent.budgetUsd)} a month</span>
                  {agent.model ? (
                    <Mono className="text-[11.5px]">
                      {agent.model} · {agent.effort}
                    </Mono>
                  ) : null}
                  {agent.account?.email ? <Mono className="text-[11.5px]">{agent.account.email}</Mono> : null}
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 t-meta text-ink-muted mt-2">
                  <span>
                    {agent.wakeCount} {agent.wakeCount === 1 ? "visit" : "visits"}
                  </span>
                  <span>
                    {agent.findingCount} {agent.findingCount === 1 ? "finding" : "findings"}
                  </span>
                  <span>{usd(agent.costUsd)}</span>
                  <span>last visit {clock(agent.lastWakeAt)}</span>
                  <Link
                    to={`/runs/${encodeURIComponent(runId)}/wakes?agent=${encodeURIComponent(agent.id)}`}
                    className="text-accent hover:underline"
                  >
                    their visits
                  </Link>
                </div>
              </div>

              <div className="bg-well border border-rule rounded-lg p-4">
                <div className="t-label text-ink-muted mb-2.5">What they are carrying</div>
                <Carrying runId={runId} agent={agent} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
