import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { clock, usd } from "../format.js";
import { Card, Failed, Loading, Mono, PageHeader } from "../components/ui.jsx";

/**
 * Who went, by cohort.
 *
 * This screen used to be a card per participant with a memory panel inside it, and the panel
 * fired its own request — one memory read per head, re-polled every five seconds. Two requests
 * serve the whole page now: the cohort roll-up and the participant list. A person's memory lives
 * on their own page, where asking for it is one request for one person (SPEC §6.2).
 */
export function Population({ runId }: { runId: string }) {
  const cohorts = useQuery({ queryKey: ["run-cohorts", runId], queryFn: () => api.runCohorts(runId) });
  const participants = useQuery({ queryKey: ["participants", runId], queryFn: () => api.participants(runId) });
  const [open, setOpen] = useState<string | null>(null);

  if (cohorts.isError) return <Failed error={cohorts.error} />;
  if (participants.isError) return <Failed error={participants.error} />;
  if (cohorts.isPending || participants.isPending) return <Loading what="the population" />;

  const people = participants.data.items;

  return (
    <>
      <PageHeader
        title="Population"
        lede="The people we sent, grouped by cohort. Open one to see who is in it; open a person to see what they are carrying between visits."
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
                <div className="flex flex-wrap gap-x-5 gap-y-1 t-meta text-ink-muted mt-2">
                  <span>{cohort.personaName}</span>
                  <span>
                    {cohort.people} {cohort.people === 1 ? "person" : "people"}
                  </span>
                  <span>
                    {cohort.visits} {cohort.visits === 1 ? "visit" : "visits"}
                  </span>
                  <span>
                    {cohort.findings} {cohort.findings === 1 ? "finding" : "findings"}
                  </span>
                  <span>{cohort.stillActive} still coming back</span>
                  <span>{usd(cohort.costUsd)}</span>
                </div>
              </button>

              {expanded ? (
                <table className="w-full mt-4 border-t border-rule">
                  <tbody>
                    {members.map((person) => (
                      <tr key={person.id} className="border-b border-rule last:border-0">
                        <td className="py-2 pr-4 t-body">{person.name}</td>
                        <td className="py-2 pr-4">
                          <Mono className="text-[11px] text-ink-muted">{person.id}</Mono>
                        </td>
                        <td className="py-2 pr-4 t-meta tabular-nums text-ink-soft">
                          {person.visits} {person.visits === 1 ? "visit" : "visits"}
                        </td>
                        <td className="py-2 pr-4 t-meta tabular-nums text-ink-soft">{person.findings} filed</td>
                        <td className="py-2 pr-4 t-meta text-ink-muted">
                          {person.retiredReason === "gave-up" ? `left at visit ${person.visits}` : person.status === "active" ? "still coming back" : "done for now"}
                        </td>
                        <td className="py-2 pr-4 t-meta text-ink-muted">{clock(person.lastVisitAt)}</td>
                        <td className="py-2 text-right">
                          <Link to={`/runs/${encodeURIComponent(runId)}/wakes?agent=${encodeURIComponent(person.id)}`} className="t-meta text-accent hover:underline">
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
      </div>
    </>
  );
}
