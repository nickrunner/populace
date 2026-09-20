import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Participant } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { Avatar, Breadcrumb, DataTable, Failed, Loading, Mono, PageHeader } from "../components/ui.jsx";

/**
 * The first screen that is only people. It is reached by asking for it — SPEC §7.4's "you had to
 * ask" — which is why a name is informative here rather than clutter on the screen above.
 */
export function PeopleWhoHit() {
  const { key } = useProject();
  const { key: sim, href } = useSimulation();
  const { signature = "" } = useParams();
  const cluster = useQuery(q.cluster(key, sim, signature));

  if (cluster.isPending) return <Loading what="everyone who hit this" />;
  if (cluster.isError) return <Failed error={cluster.error} />;

  const card = cluster.data;
  // Which visit each of them filed it on, from the quotes. A person who hit it twice is listed
  // once, on the visit they first said something about it.
  const filedOn = new Map(card.quotes.map((quote) => [quote.personId, quote]));
  // Everyone here is a person AS THEY WERE IN THE EXECUTION THAT REPORTED THIS, which for a problem
  // the latest execution did not report is an earlier one. Their page is told which, because agent
  // ids repeat across executions and it would otherwise read somebody else's run quite happily.
  const execution = `?execution=${encodeURIComponent(card.representative.runId)}`;

  return (
    <>
      <Breadcrumb items={[{ label: "Results", to: href() }, { label: card.title, to: href(`f/${encodeURIComponent(signature)}`) }, { label: "Everyone who hit it" }]} />
      <PageHeader
        title="Everyone who hit it"
        lede={`${card.peopleHit.length} of the ${card.peopleTotal} people who went ran into this. Open one to see what they were carrying between visits, or open the visit to watch it happen.`}
      />

      <DataTable<Participant>
        rows={card.peopleHit}
        keyOf={(person) => person.id}
        empty="Nobody hit this in the execution these results are of."
        columns={[
          {
            header: "Person",
            cell: (person) => (
              <Link to={href(`people/${encodeURIComponent(person.id)}${execution}`)} className="flex items-center gap-2.5 hover:text-accent">
                <Avatar name={person.name} />
                <span className="t-body">{person.name}</span>
              </Link>
            ),
          },
          { header: "Cohort", cell: (person) => <span className="t-meta text-ink-soft">{person.cohortName || person.cohortSlug}</span> },
          { header: "Persona", cell: (person) => <span className="t-meta text-ink-muted">{person.personaName}</span> },
          {
            header: "Said it on",
            cell: (person) => {
              const quote = filedOn.get(person.personId);
              return quote === undefined ? (
                <span className="t-meta text-ink-muted">—</span>
              ) : (
                <Link to={href(`visits/${encodeURIComponent(quote.wakeId)}`)} className="t-meta text-accent hover:underline">
                  visit {quote.visitNumber}
                </Link>
              );
            },
          },
          { header: "Visits", align: "right", cell: (person) => <span className="t-meta text-ink-soft">{person.visits}</span> },
          { header: "Filed", align: "right", cell: (person) => <span className="t-meta text-ink-soft">{person.findings}</span> },
          {
            header: "Since",
            cell: (person) => (
              <span className={`t-meta ${person.retiredReason === "gave-up" ? "text-critical" : "text-ink-muted"}`}>
                {person.retiredReason === "gave-up" ? `left at visit ${person.visits}` : person.status === "active" ? "still coming back" : "done for now"}
              </span>
            ),
          },
          { header: "", cell: (person) => <Mono className="text-[11px] text-ink-muted">{person.personId}</Mono> },
        ]}
      />
    </>
  );
}
