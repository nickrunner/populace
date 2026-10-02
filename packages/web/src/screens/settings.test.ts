import { describe, expect, it } from "vitest";

import { judgeOptions, judgeWarning } from "./Settings.js";

/**
 * The judge picker, which is the one control on the settings screen that can break something
 * silently and for ever.
 *
 * A judge whose credential this install has not got does not fall back to the free one — it
 * REFUSES (`judgeRefusal` in the server) — and for the unattended report cycle that refusal is the
 * error on a job row nobody is watching. So the screen offered, and on price recommended, a choice
 * it had no way of knowing was impossible: `SettingsView` carried `hasApiKey` and nothing about
 * `TYPESAFE_API_KEY`. These assert the two halves of the fix, and this package has no
 * component-rendering tests, so they are asserted on the functions the picker is built from.
 */
describe("the judge options", () => {
  it("offers every judge when this install has both keys", () => {
    const options = judgeOptions({ model: true, typed: true });
    expect(options.map((option) => option.value)).toEqual(["model", "typesafe", "heuristic"]);
    expect(options.some((option) => option.disabled === true)).toBe(false);
  });

  it("holds the typed judge at a bound, and names the key, when there is none", () => {
    const typed = judgeOptions({ model: true, typed: false }).find((option) => option.value === "typesafe");
    expect(typed?.disabled).toBe(true);
    expect(typed?.label).toContain("TYPESAFE_API_KEY");

    // The free judge needs no credential and so is never bound: there has to be something
    // choosable on an install with no keys at all.
    const options = judgeOptions({ model: false, typed: false });
    expect(options.find((option) => option.value === "heuristic")?.disabled).toBeUndefined();
    expect(options.find((option) => option.value === "model")?.disabled).toBe(true);
  });

  /**
   * The bound cannot be reached by a judge that is ALREADY chosen — from a saved setting, a file,
   * or an install that lost the variable — which is exactly the state that breaks every cycle.
   */
  it("says the key is missing beside a judge already chosen without it, in place of the price", () => {
    const warning = judgeWarning("typesafe", { model: true, typed: false });
    expect(warning).toContain("TYPESAFE_API_KEY");
    expect(warning).toContain("refuse");
    expect(warning).not.toContain("penny");

    // With the key, the same field says what it costs instead.
    expect(judgeWarning("typesafe", { model: true, typed: true })).toContain("$0.042");
    expect(judgeWarning("heuristic", { model: false, typed: false })).toContain("Nothing");
  });
});
