import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { clock, usd } from "../format.js";
import { Bar, Card, Failed, Loading, Mono, PageHeader } from "../components/ui.jsx";

/**
 * Who went, by cohort.
 *
 * This screen used to be a card per participant with a memory panel inside it, and the panel
 * fired its own request — one memory read per head, re-polled every five seconds. Two requests
 * serve the whole page now: the cohort roll-up and the participant list. A person's memory lives
 * on their own page, where asking for it is one request for one person (SPEC §6.2).
 */
export function RunCohorts({ runId }: { runId: string }) {
  const { href } = useSimulation();
  const cohorts = useQuery(q.runCohorts(runId));
  const participants = useQuery(q.participants(runId));
  const [open, setOpen] = useState<string | null>(null);

  if (cohorts.isError) return <Failed error={cohorts.error} />;
  if (participants.isError) return <Failed error={participants.error} />;
  if (cohorts.isPending || participants.isPending) return <Loading what="the population" />;

  const people = participants.data.items;
  const biggest = Math.max(...cohorts.data.items.map((cohort) => cohort.people), 1);

  return (
    <>
      <PageHeader
        title="Population"
        lede="The people this execution sent, grouped by cohort. Open one to see who is in it; open a person to see what they are carrying between visits."
      />

      <div className="flex flex-col gap-4">
        {cohorts.data.items.map((cohort) => {
          const members = people.filter((person) => person.cohortSlug === cohort.cohortSlug);
          const expanded = open === cohort.cohortSlug;
          return (
            <Card key={cohort.cohortSlug} className="p-5">
              <button type="button" className="w-full text-left" onClick={() => setOpen(expanded ? null : cohort.cohortSlug)}>
                <div className="flex items-baseline gap-3">
                  <div className="t-finding">{cohort.name}</div>
                  <Mono className="text-[11px] text-ink-muted">{cohort.cohortSlug}</Mono>
                  <span className="ml-auto t-meta text-ink-muted">{cohort.headline}</span>
                </div>
                <div className="mt-2 mb-2 max-w-[18rem]">
                  <Bar value={cohort.people} of={biggest} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 t-meta text-ink-muted tabular-nums">
                  <span>{cohort.personaName}</span>
                  <span>
                    {cohort.people} {cohort.people === 1 ? "person" : "people"}
                  </span>
                  <span>
                    {cohort.visits} {cohort.visits === 1 ? "visit" : "visits"}
                  </span>
                  <span>
                    {cohort.findings} filed, {cohort.confirmed} confirmed
                  </span>
                  <span className={cohort.gaveUp > 0 ? "text-critical" : undefined}>{cohort.gaveUp} walked away</span>
                  <span>{cohort.stillActive} still coming back</span>
                  <span>{usd(cohort.costUsd)}</span>
                </div>
              </button>

              {expanded ? (
                <table className="w-full mt-4 border-t border-rule">
                  <tbody>
                    {members.map((person) => (
                      <tr key={person.id} className="border-b border-rule last:border-0">
                        <td className="py-2 pr-4">
                          <Link to={href(`people/${encodeURIComponent(person.id)}`)} className="t-body hover:text-accent">
                            {person.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 t-meta tabular-nums text-ink-soft">
                          {person.visits} {person.visits === 1 ? "visit" : "visits"}
                        </td>
                        <td className="py-2 pr-4 t-meta tabular-nums text-ink-soft">{person.findings} filed</td>
                        <td className="py-2 pr-4 t-meta text-ink-muted">
                          {person.retiredReason === "gave-up" ? `left at visit ${person.visits}` : person.status === "active" ? "still coming back" : "done for now"}
                        </td>
                        <td className="py-2 pr-4 t-meta text-ink-muted tabular-nums">{clock(person.lastVisitAt)}</td>
                        <td className="py-2 text-right">
                          <Link to={href(`visits?participant=${encodeURIComponent(person.id)}`)} className="t-meta text-accent hover:underline">
                            their visits
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </Card>
          );
        })}
        {cohorts.data.items.length === 0 ? <Card className="p-4">Nobody went on this execution.</Card> : null}
      </div>
    </>
  );
}
