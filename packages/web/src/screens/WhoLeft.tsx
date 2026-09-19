import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { inTheirWords } from "../format.js";
import { Avatar, Card, Failed, Loading, PageHeader } from "../components/ui.jsx";

/**
 * Who walked away, and whether they said they would come back. The second half is what the
 * fix-validation loop runs on: a carry-forward only brings back the people who said they would
 * return (ADR-0020), so this screen is where that promise is recorded.
 *
 * It says their names. The copy here used to read "said she would come back if it were fixed" —
 * one gendered pronoun standing in for a whole population, which was wrong about most of them
 * and told the reader nothing. A person who leaves is the one thing worth naming on this screen.
 */
export function WhoLeft({ runId }: { runId: string }) {
  const { href } = useSimulation();
  const findings = useQuery(q.findings(runId, "?kind=abandonment"));
  const participants = useQuery(q.participants(runId));

  // Both: the roster is a second request, and waiting on one that has already failed shows
  // "Reading who left…" for ever with nothing to say why.
  if (findings.isError || participants.isError) return <Failed error={findings.error ?? participants.error} />;
  const findingData = findings.data;
  const participantData = participants.data;
  if (!findingData || !participantData) return <Loading what="who left" />;

  const left = findingData.items;

  return (
    <>
      <PageHeader
        title="Who walked away"
        lede="The people who stopped coming back, what it was over, and whether they said a fix would bring them back."
      />

      {left.length === 0 ? (
        <p className="t-body text-ink-muted italic">Nobody has walked away. Everyone we sent is still coming back.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {left.map((finding) => {
            const person = participantData.items.find((candidate) => candidate.id === finding.agentId);
            const name = person?.name ?? finding.personaId;
            const first = name.split(/\s+/)[0] ?? name;
            return (
              <Card key={finding.id} className="p-5">
                <div className="flex gap-3.5">
                  <Avatar name={name} />
                  <div className="min-w-0 flex-1">
                    <h2 className="t-finding mb-1.5">{finding.title}</h2>
                    <p className="t-body text-ink italic mb-3">“{inTheirWords(finding)}”</p>
                    <div className="flex flex-wrap items-center gap-4 t-meta text-ink-muted">
                      <span>
                        {person === undefined ? (
                          name
                        ) : (
                          <Link to={href(`people/${encodeURIComponent(person.id)}`)} className="text-accent hover:underline">
                            {name}
                          </Link>
                        )}
                        {person?.cohortName ? ` · ${person.cohortName}` : ""} · visit {person?.visits ?? "—"}
                      </span>
                      <span className={person?.wouldReturn === true ? "text-confirmed" : undefined}>
                        {person?.wouldReturn === true
                          ? `${first} said a fix would bring them back`
                          : person?.wouldReturn === false
                            ? `${first} said nothing would bring them back`
                            : `${first} did not say whether they would come back`}
                      </span>
                      <Link to={href(`visits/${encodeURIComponent(finding.wakeId)}`)} className="text-accent hover:underline">
                        watch the visit they left on
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
