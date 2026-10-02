import { describe, expect, it } from "vitest";

import { sharePercents, shownWeight } from "./WeightedMixEditor.js";

/**
 * The arithmetic behind the mix editor's column of percentages.
 *
 * The one property that matters is that the column sums to 100: a reader balancing three
 * personas by eye reads 33 / 33 / 33 as "one percent went missing", and a percentage column
 * that does not add up is the kind of thing that makes every other figure on the page look
 * approximate. Largest remainder is the rule, and the tie rule — earlier rows first — is the
 * same one the deal itself uses (ADR-0041), so the editor's preview and the study's deal cannot
 * quietly favour different rows.
 */
describe("sharePercents", () => {
  it("sums to exactly 100 for any positive weights", () => {
    const fixtures: readonly (readonly number[])[] = [
      [1, 1, 1],
      [1, 2],
      [3, 4],
      [1, 1, 1, 1, 1, 1, 1],
      [7, 13, 29, 51],
      [1, 99],
      [1, 1, 1, 1, 1, 1],
      [2, 3, 5, 7, 11, 13, 17, 19, 23],
    ];
    for (const weights of fixtures) {
      const percents = sharePercents(weights);
      expect(percents.reduce((sum, share) => sum + share, 0)).toBe(100);
      expect(percents).toHaveLength(weights.length);
    }
  });

  it("gives the leftover points to the largest fractional parts", () => {
    // 1/3 each is 33.33…: two floors of 33 and one leftover point, which goes to the EARLIEST
    // row because all three fractions tie.
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    // 3/7 ≈ 42.86, 4/7 ≈ 57.14: the .86 wins the one leftover point over the .14.
    expect(sharePercents([3, 4])).toEqual([43, 57]);
    // 1/6 ≈ 16.67 ×6 = 96 after flooring; four points to give, to the first four on the tie.
    expect(sharePercents([1, 1, 1, 1, 1, 1])).toEqual([17, 17, 17, 17, 16, 16]);
  });

  it("is exact where the shares already are", () => {
    expect(sharePercents([1, 1])).toEqual([50, 50]);
    expect(sharePercents([1, 3])).toEqual([25, 75]);
    expect(sharePercents([5])).toEqual([100]);
  });

  it("gives all zeros when nothing weighs anything", () => {
    expect(sharePercents([])).toEqual([]);
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    expect(sharePercents([-1, Number.NaN])).toEqual([0, 0]);
  });

  it("treats a weight that is not a positive finite number as nothing, not as everything", () => {
    expect(sharePercents([Number.NaN, 1, 1])).toEqual([0, 50, 50]);
    expect(sharePercents([Number.POSITIVE_INFINITY, 1])).toEqual([0, 100]);
  });
});

describe("shownWeight", () => {
  it("shows a stored fraction rounded and a legal integer as itself", () => {
    expect(shownWeight(3)).toBe(3);
    expect(shownWeight(2.4)).toBe(2);
    expect(shownWeight(2.5)).toBe(3);
  });

  it("never shows less than one part", () => {
    expect(shownWeight(0)).toBe(1);
    expect(shownWeight(-4)).toBe(1);
    expect(shownWeight(0.2)).toBe(1);
    expect(shownWeight(Number.NaN)).toBe(1);
    expect(shownWeight(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
