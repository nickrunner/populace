import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { ClusterCard } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people as peopleWord, usd, when } from "../format.js";
import { Incidence } from "../components/ClusterRow.jsx";
import { Breadcrumb, Card, Empty, Failed, Loading, PageHeader, Severity, ToolName } from "../components/ui.jsx";

/**
 * Two executions, side by side — and the one screen in the product that has to be careful about
 * what it claims.
 *
 * A problem is matched across executions by its SIGNATURE: a hash of its kind, its primary tool
 * and the sorted content words of its title (ADR-0028). Stage 5 measured how well that holds and
 * the result is a cliff, not a curve: identical wording recurs 100% of the time and survives
 * punctuation and filler, but a complaint the model rewords from scratch recurs 0% of the time,
 * because one different content word is a different key by construction
 * (`packages/reports/src/stability.test.ts`).
 *
 * So this screen reports an ABSENCE AS AN ABSENCE. It never says "you fixed this", because it
 * cannot know that: the same person may have hit the same thing and described it differently.
 * The word `fixed` belongs to the triage control, where a human types it.
 */

const CAVEAT =
  "A problem is matched between executions by the exact words in its title, so a complaint worded differently the second time reads as gone and as new at once. Open one and read the evidence before you call anything fixed.";

function Row({ card }: { card: ClusterCard }) {
  const { href } = useSimulation();
  return (
    <Link to={href(`f/${encodeURIComponent(card.signature)}`)} className="block p-3.5 hover:bg-well">
      <div className="flex items-baseline gap-2.5 mb-1">
        <Severity value={card.severity} kind={card.kind} />
        {card.tool ? <ToolName name={card.tool} missing={card.kind === "coverage-gap"} /> : null}
      </div>
      <div className="t-body text-ink mb-2">{card.title}</div>
      <div className="t-meta text-ink-muted tabular-nums mb-2">
        {card.peopleHit} of {peopleWord(card.peopleTotal)} · {card.reports} {card.reports === 1 ? "report" : "reports"}
      </div>
      <Incidence cohorts={card.cohorts} />
    </Link>
  );
}

function Column({ title, sub, cards, empty }: { title: string; sub: string; cards: ClusterCard[]; empty: string }) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="t-section">
          {title} <span className="t-meta text-ink-muted tabular-nums font-normal">{cards.length}</span>
        </h2>
        <p className="t-meta text-ink-muted max-w-[46ch]">{sub}</p>
      </div>
      {cards.length === 0 ? (
        <Card className="p-4">
          <Empty>{empty}</Empty>
        </Card>
      ) : (
        <Card className="divide-y divide-rule">
          {cards.map((card) => (
            <Row key={card.signature} card={card} />
          ))}
        </Card>
      )}
    </section>
  );
}

export function Compare() {
  const { key } = useProject();
  const { key: sim, href } = useSimulation();
  const [params] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const compare = useQuery(q.compare(key, sim, a, b));
  // Already in the cache from the results screen; it is read here only to turn a run id into the
  // execution number a reader recognises, which `RunSummary` does not carry.
  const results = useQuery(q.results(key, sim));

  if (a === "" || b === "")
    return (
      <>
        <PageHeader title="Compare two executions" />
        <Card className="p-4">
          <Empty>Pick two executions on the history screen and they will be put side by side here.</Empty>
        </Card>
        <Link to={href("executions")} className="inline-block mt-3 t-body text-accent hover:underline">
          Executions
        </Link>
      </>
    );
  if (compare.isPending) return <Loading what="both executions" />;
  if (compare.isError) return <Failed error={compare.error} />;

  const { a: earlier, b: later, persisting, fixed, appeared, castIdentical, notes } = compare.data;
  const seqOf = new Map((results.data?.history ?? []).map((entry) => [entry.runId, entry.seq]));
  const numbered = (runId: string, fallback: string): string => {
    const seq = seqOf.get(runId);
    return seq === undefined ? fallback : `execution ${seq}`;
  };

  return (
    <>
      <Breadcrumb items={[{ label: "Results", to: href() }, { label: "Executions", to: href("executions") }, { label: "Side by side" }]} />
      <PageHeader
        title={`${numbered(earlier.id, earlier.label)} against ${numbered(later.id, later.label)}`}
        lede="What was reported in both, what the later one did not report, and what turned up in it that had not before."
      />

      <div className="grid grid-cols-2 gap-6 mb-8 pb-7 border-b border-rule">
        {[earlier, later].map((run, index) => (
          <div key={run.id}>
            <div className="t-label text-ink-muted mb-1.5">
              {index === 0 ? "Earlier" : "Later"} · {numbered(run.id, run.label)}
            </div>
            <div className="t-body text-ink">{run.startedAt === null ? "never started" : when(run.startedAt)}</div>
            <div className="t-meta text-ink-muted tabular-nums mt-1">
              {run.totals.wakes} visits · {run.totals.findings} reports · {run.totals.confirmed} confirmed · {usd(run.totals.costUsd)}
            </div>
          </div>
        ))}
      </div>

      <Card className="p-4 mb-8 bg-well">
        <p className="t-body text-ink">{CAVEAT}</p>
        {castIdentical ? (
          <p className="t-meta text-ink-muted mt-2">Both executions sent the same people, so a difference below is not a difference in who went.</p>
        ) : null}
        {notes.map((note) => (
          <p key={note} className="t-meta text-ink-muted mt-2">
            {note}
          </p>
        ))}
      </Card>

      <div className="flex flex-col gap-8">
        <Column
          title="Reported in both"
          sub="The same problem came up either side. This is the reliable half of the comparison."
          cards={persisting}
          empty="Nothing was reported in both executions."
        />
        <Column
          title="Not reported in the later one"
          sub="An absence, and only an absence. It may be fixed, or it may have been described in different words this time."
          cards={fixed}
          empty="Everything the earlier execution reported came up again."
        />
        <Column
          title="Only in the later one"
          sub="Either genuinely new, or the same problem worded differently. Read one and see."
          cards={appeared}
          empty="The later execution reported nothing the earlier one had not."
        />
      </div>
    </>
  );
}
