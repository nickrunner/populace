import type { RunEstimate } from "@populace/contract";
import { forwardRef, type ReactNode } from "react";

import { people as peopleWord, plural } from "../../format.js";
import { Stack } from "../atoms/index.js";
import { MetaSentence, Money, Stat, StatGroup } from "../molecules/index.js";

/**
 * CostEstimate — what it will come to, and what that figure is a figure *of*.
 *
 * ATOMIC-INVENTORY §5 names this organism on four pages — `GetStarted` (row 4), `NewSimulation`
 * (row 5), `Preflight` (row 6) and `People` (row 12) — and §6.3 calls out "the third
 * `CostEstimate`" and "the fourth" by name. It was never built, so the port shipped four
 * renderings of it: two verbatim copies of a `basisOf()` function, three phrasings of the basis
 * sentence, and two layouts that did the same arithmetic in different places. This is the one.
 *
 * **The estimate names its own basis, always.** §6.3 row 15 lists that among the things
 * `GetStarted` gets right and must survive, and it is the whole reason a reader believes the
 * number: a price is either drawn from visits this machine actually ran, or it is a default
 * standing in for a machine that has run nothing. Both sentences say which, out loud, and both
 * are written here rather than at a call site, because four call sites wrote three of them.
 *
 * **It never implies the number is exact** (§7.3, ADR-0028). Outcomes vary between executions by
 * design; what each person does on a visit varies with them. So the figure is always prefixed
 * *about*, the basis sentence says *a range rather than a bill* where the visits are capped and
 * *a rate rather than a total* where nothing caps them, and the last word goes to the guardrails:
 * the ceilings in settings are what stop an execution, whatever the arithmetic says. Nothing here
 * promises a repeat of anything.
 *
 * **Two layouts, one set of facts.** `stats` is the ruled strip a form or a preflight reads down
 * — three figures, or four when the page has a fourth to put beside them. `sentence` is the same
 * arithmetic said out loud, for a wizard step and a composition screen where a strip of 32px
 * figures would outweigh the thing being composed. Both end on the basis sentence; that is the
 * part neither layout is allowed to drop.
 *
 * **Nothing about a person's identity appears here**, and no persona is named: this counts
 * people, visits and dollars (§7.4).
 */

/**
 * Where the per-visit price came from, in the words the UI speaks.
 *
 * This is deliberately NOT `RunEstimate` itself. The wire still carries `agents`, `perWakeUsd`
 * and `assumedWakesPerAgent` — ADR-0032's rows keep their names — and "agent" and "wake" may not
 * reach a prop name any more than they may reach a label (§7.2). `costBasisOf()` below is the one
 * translation, so a fifth screen does not write a fifth.
 */
export interface CostBasis {
  /** `history` — priced from visits this machine ran. `default` — a stand-in, nothing ran yet. */
  from: "history" | "default";
  /** How many visits the history is drawn from. Zero when `from` is `default`. */
  sampleSize: number;
  /** What one visit cost. */
  perVisitUsd: number;
  /** The ends the server put either side of its central figure, when it published them. */
  low?: number;
  /** The high end, with `low`. Both or neither; one alone is not a range. */
  high?: number;
}

/**
 * How many visits the people are going to make, which is what separates a total from a rate.
 *
 * - `capped` — a set number each, and then it stops. The figure is a range around a total.
 * - `assumed` — nothing caps them, but the server priced N each so there would be a figure at
 *   all. The number is only as good as the assumption, and the sentence says the assumption.
 * - `round` — nothing caps them and nothing is assumed: one round, one visit each, priced as
 *   what it costs every time they all come back.
 */
export type VisitPlan =
  | { kind: "capped"; each: number }
  | { kind: "assumed"; each: number }
  | { kind: "round" };

export interface CostEstimateProps {
  /** The ruled strip of figures, or the same facts as a sentence. Default `stats`. */
  layout?: "stats" | "sentence";
  /** How many people go. */
  people: number;
  /** How many cohorts they are composed of; becomes the sub-line under the headcount. */
  cohorts?: number;
  plan: VisitPlan;
  /** `null` when nothing has run on this machine yet and there is no price to work from. */
  basis: CostBasis | null;
  /**
   * Replaces the cohort count under the headcount, for a page whose population is not chosen
   * yet — "no population chosen" is a truer sub-line there than "0 cohorts".
   */
  peopleSub?: ReactNode;
  /**
   * One more `Stat` on the end of the strip, for a page that measures something else in the same
   * breath — `Preflight`'s "Tools they will meet". Ignored by the `sentence` layout.
   */
  trailing?: ReactNode;
}

/** The visits the plan comes to. A round is one visit each; the other two are `each` apiece. */
function visitsOf(people: number, plan: VisitPlan): number {
  return plan.kind === "round" ? people : people * plan.each;
}

/**
 * The basis sentence — the one that was written three ways.
 *
 * Sentence one says where the price came from. Sentence two says what kind of figure it is, and
 * it is the honesty clause in miniature: capped visits give a range, uncapped ones give a rate,
 * and an unpriced machine gives neither — only the ceilings that will stop it regardless.
 */
function basisSentence(basis: CostBasis | null, plan: VisitPlan): string {
  if (basis === null) {
    return "Nothing has run on this machine yet, so there is no price to work from. The ceilings in settings are what stop an execution, whatever any arithmetic says.";
  }
  const from =
    basis.from === "history"
      ? `Priced from the last ${plural(basis.sampleSize, "visit")} this machine ran.`
      : "Priced from a default, because nothing has been visited on this machine yet.";
  if (plan.kind === "capped") {
    return `${from} What each person actually does varies between executions, so treat it as a range rather than a bill.`;
  }
  if (plan.kind === "assumed") {
    return `${from} Nothing caps the visits, and this assumes ${plural(plan.each, "visit")} each, so it is a rate rather than a total.`;
  }
  return `${from} Nothing caps the visits, so this is a rate rather than a total.`;
}

/** What the visits stat says about itself, under the count. */
function visitsSub(plan: VisitPlan): string {
  if (plan.kind === "capped") return "and then it stops";
  if (plan.kind === "assumed") return `${plural(plan.each, "visit")} each, assumed`;
  return "a round; nothing caps it but you";
}

export const CostEstimate = forwardRef<HTMLElement, CostEstimateProps>(function CostEstimate(
  { layout = "stats", people, cohorts, plan, basis, peopleSub, trailing },
  ref,
) {
  const visits = visitsOf(people, plan);
  // The server's own `expectedUsd` is `perWakeUsd × visits` to the cent (server/estimate.ts), so
  // this is the same figure rather than a second opinion about it — and it stays right while a
  // reader is still typing a headcount into the form the estimate was fetched before.
  const total = basis === null ? null : basis.perVisitUsd * visits;
  const range =
    basis === null || basis.low === undefined || basis.high === undefined
      ? null
      : { low: basis.low, high: basis.high };

  const sub =
    peopleSub === undefined
      ? cohorts === undefined
        ? undefined
        : plural(cohorts, "cohort")
      : peopleSub;

  if (layout === "sentence") {
    return (
      <Stack ref={ref} gap={2}>
        <MetaSentence>
          {plan.kind === "round" ? (
            <>
              {peopleWord(people)} = {plural(visits, "visit")} a round
              {total === null || basis === null ? (
                "."
              ) : (
                <>
                  , about <Money usd={total} /> each time they all come back, at{" "}
                  <Money usd={basis.perVisitUsd} precision={4} /> a visit.
                </>
              )}
            </>
          ) : (
            <>
              {peopleWord(people)} × {plural(plan.each, "visit")} each
              {plan.kind === "assumed" ? ", assumed" : ""} = {plural(visits, "visit")}
              {total === null || basis === null ? (
                "."
              ) : (
                <>
                  , about <Money usd={total} /> at{" "}
                  <Money usd={basis.perVisitUsd} precision={4} /> a visit.
                </>
              )}
            </>
          )}
        </MetaSentence>
        <MetaSentence>{basisSentence(basis, plan)}</MetaSentence>
      </Stack>
    );
  }

  return (
    <Stack ref={ref} gap={4}>
      <StatGroup cols={trailing === undefined ? 3 : 4} ruled>
        <Stat label="People going" value={people} sub={sub} />
        <Stat label="Visits planned" value={visits} sub={visitsSub(plan)} />
        <Stat
          label="Expected cost"
          // An em dash, not "$0.00": a price nobody has measured is absent, not free.
          value={total === null ? "—" : <Money usd={total} />}
          sub={
            basis === null ? (
              "no price to work from yet"
            ) : range === null ? (
              <>
                at <Money usd={basis.perVisitUsd} precision={4} /> a visit
              </>
            ) : (
              <>
                <Money usd={range.low} />–<Money usd={range.high} />, at{" "}
                <Money usd={basis.perVisitUsd} precision={4} /> a visit
              </>
            )
          }
        />
        {trailing}
      </StatGroup>
      <MetaSentence>{basisSentence(basis, plan)}</MetaSentence>
    </Stack>
  );
});

/**
 * The wire's estimate, in the words the UI speaks — the single translation of `RunEstimate`.
 *
 * `undefined` in (no simulation to price against, or the query has not answered) gives `null`
 * out, which is the unpriced case the component already has a sentence for. The low and high ends
 * travel only when they are a range around *these* visits: a caller that has changed the headcount
 * or the visit count since the estimate was fetched passes `withRange: false`, because the
 * server's ends were drawn around a different plan and a range around the wrong total is worse
 * than no range at all.
 */
export function costBasisOf(
  estimate: RunEstimate | undefined,
  withRange = false,
): CostBasis | null {
  if (estimate === undefined) return null;
  return {
    from: estimate.basis,
    sampleSize: estimate.sampleSize,
    perVisitUsd: estimate.perWakeUsd,
    ...(withRange ? { low: estimate.lowUsd, high: estimate.highUsd } : {}),
  };
}

/**
 * The wire's plan, in the same words: capped where the simulation caps itself, otherwise the
 * server's own assumption where it published one, and a bare round where it did not.
 */
export function visitPlanOf(estimate: RunEstimate, visitsEach: number | null): VisitPlan {
  if (visitsEach !== null) return { kind: "capped", each: visitsEach };
  return estimate.assumedWakesPerAgent === null
    ? { kind: "round" }
    : { kind: "assumed", each: estimate.assumedWakesPerAgent };
}
