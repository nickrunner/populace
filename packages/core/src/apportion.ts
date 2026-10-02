/**
 * The deal: how a study's ONE size becomes people, cohort by cohort and then persona by persona
 * (ADR-0041). A cohort is personas with weights, a population is cohorts with weights, and a study
 * picks a population and gives it a size; the two functions here are the whole of the arithmetic
 * that turns those weights into counts.
 *
 * This file is browser-safe on purpose — nothing in it touches `node:crypto` — and is exported
 * from `isomorphic.ts`, so the builders preview exactly the arithmetic the server performs, live,
 * without a round trip and without a second implementation that could drift.
 */

/**
 * How many of `size` people each entry of a mix gets — Sainte-Laguë highest averages.
 *
 * The property that matters is that it is HOUSE-MONOTONE: growing the size never shrinks an
 * entry, so raising a study from 10 to 11 people adds one person somewhere and archives nobody.
 * Largest-remainder rounding does not have that property (the Alabama paradox), and a cohort that
 * archived somebody because it grew would break ADR-0031 for no reason anybody could see. Ties go
 * to the earlier entry, so the result is a pure function of `(size, weights)` — a stated rule the
 * builders preview, not an accident.
 *
 * A weight that is not a positive finite number counts for nothing, and when EVERY weight is like
 * that the answer is all zeros: nobody is dealt on the strength of a `NaN`. (It used to hand the
 * whole size to index 0, which is what a spreadsheet does with a broken formula.) A non-integer
 * size is floored, and a size below nought is nought.
 *
 * At small sizes a light entry gets nobody; that is the honest answer and the editor says so.
 */
export function apportion(size: number, weights: readonly number[]): number[] {
  const seats = weights.map(() => 0);
  if (weights.length === 0) return seats;
  const usable = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  if (!usable.some((w) => w > 0)) return seats;
  const total = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  for (let seat = 0; seat < total; seat++) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < usable.length; i++) {
      const score = (usable[i] ?? 0) / (2 * (seats[i] ?? 0) + 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    seats[best] = (seats[best] ?? 0) + 1;
  }
  return seats;
}

/** One cohort in a population, and its share of the size. Member order is the tie order. */
export interface DealMember {
  cohortId: string;
  weight: number;
}

/** One cohort's mix: which personas, in what ratio. Entry order is the tie order within the cohort. */
export interface DealMix {
  cohortId: string;
  entries: readonly { personaId: string; weight: number }[];
}

/** One (cohort, persona) pair and how many people it gets. */
export interface DealtLane {
  cohortId: string;
  personaId: string;
  count: number;
}

/**
 * What a study of a given size sends. `sends` is the sum of the lanes, which is the sum of the
 * cohort counts EXCEPT when a cohort has no mix to deal into: that cohort keeps its count and
 * contributes nothing, and the difference is the builder's cue that a cohort still needs personas.
 */
export interface Dealt {
  cohorts: { cohortId: string; count: number; lanes: DealtLane[] }[];
  sends: number;
}

/**
 * The two-level deal. First the size is apportioned across the population's members by their
 * weights, in MEMBER ORDER; then each cohort's count is apportioned across its mix by the entries'
 * weights, in MIX ORDER. A member whose mix is missing or empty gets its cohort count and zero
 * lanes.
 *
 * Both levels are `apportion`, and the composition of two house-monotone maps is house-monotone,
 * so growing a study by one never shrinks any lane: "growing re-deals nobody" holds end to end.
 * Changing a WEIGHT at either level can move people (ADR-0039 accepts this and the builders say
 * so), and editing one cohort's mix re-lanes only that cohort, because its count is settled
 * before its mix is looked at.
 */
export function dealStudy(size: number, members: readonly DealMember[], mixes: readonly DealMix[]): Dealt {
  const cohortCounts = apportion(
    size,
    members.map((m) => m.weight),
  );
  const mixOf = new Map(mixes.map((mix) => [mix.cohortId, mix]));
  let sends = 0;
  const cohorts = members.map((member, index) => {
    const count = cohortCounts[index] ?? 0;
    const mix = mixOf.get(member.cohortId);
    if (!mix || mix.entries.length === 0) return { cohortId: member.cohortId, count, lanes: [] };
    const laneCounts = apportion(
      count,
      mix.entries.map((entry) => entry.weight),
    );
    const lanes = mix.entries.map((entry, i): DealtLane => ({ cohortId: member.cohortId, personaId: entry.personaId, count: laneCounts[i] ?? 0 }));
    for (const lane of lanes) sends += lane.count;
    return { cohortId: member.cohortId, count, lanes };
  });
  return { cohorts, sends };
}
