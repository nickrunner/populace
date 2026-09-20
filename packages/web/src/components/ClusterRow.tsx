import { Link } from "react-router-dom";
import type { ClusterCard } from "../api.js";
import { useSimulation } from "../context.jsx";
import { ago, stateOfCluster } from "../format.js";
import { Bar, Severity, ToolName, Verdict } from "./ui.jsx";

/**
 * One row is one thing that is actually wrong, not one report: the same complaint from three
 * people is a single row here, which is the whole point of clustering (ADR-0017).
 *
 * It is keyed by SIGNATURE now rather than by a cluster's position in one execution's digest, so
 * the row survives a re-execution and carries what happened to it across them (ADR-0028). And it
 * names nobody: this is level two, and a name first appears one click further in (SPEC §7.1).
 */
export function ClusterRow({ card, seqs, mode }: { card: ClusterCard; seqs: number[]; mode: "ephemeral" | "longitudinal" }) {
  const { href } = useSimulation();
  const state = stateOfCluster(card, mode, seqs);
  return (
    <Link to={href(`f/${encodeURIComponent(card.signature)}`)} className="block bg-card border border-rule rounded-lg p-4 hover:border-rule-strong transition-colors">
      <div className="flex items-baseline gap-2.5 mb-1.5">
        <Severity value={card.severity} kind={card.kind} />
        {card.tool ? <ToolName name={card.tool} missing={card.kind === "coverage-gap"} /> : null}
        <span className="flex-1" />
        <span className={`t-label ${state.ink}`}>{state.badge}</span>
        <span className="t-meta text-ink-muted">{state.detail}</span>
      </div>

      <h3 className="t-finding mb-1.5">{card.title}</h3>

      <div className="flex flex-wrap items-center gap-4 t-meta text-ink-muted mb-3">
        <span className="tabular-nums">
          {card.peopleHit} of {card.peopleTotal} {card.peopleTotal === 1 ? "person" : "people"}
        </span>
        <span className="tabular-nums">
          {card.reports} {card.reports === 1 ? "report" : "reports"}
        </span>
        <Verdict value={card.verdict} />
        {card.triage === null ? null : <span>marked {card.triage.state.replace("-", " ")}</span>}
      </div>

      <Incidence cohorts={card.cohorts} />
    </Link>
  );
}

/**
 * Who it happened to, by cohort. This is the number the whole restructure is for: "six of the
 * twelve first-timers and none of the eight sceptics" is a different problem from "nine people",
 * and it is readable without naming one of them.
 */
export function Incidence({ cohorts }: { cohorts: ClusterCard["cohorts"] }) {
  if (cohorts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {cohorts.map((cohort) => (
        <div key={cohort.slug} className="w-32">
          <div className="flex items-baseline justify-between gap-2 t-meta text-ink-muted mb-1">
            <span className="truncate">{cohort.name}</span>
            <span className="tabular-nums shrink-0">
              {cohort.hit}/{cohort.total}
            </span>
          </div>
          <Bar value={cohort.hit} of={cohort.total} tone={cohort.hit === 0 ? "quiet" : "accent"} />
        </div>
      ))}
    </div>
  );
}

/** The same thing said in prose, for a card with no room for bars. */
export function lastSeenWords(card: ClusterCard): string {
  return card.lastSeenAt === null ? "not seen yet" : `last reported ${ago(card.lastSeenAt)}`;
}
