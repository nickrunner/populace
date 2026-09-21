import { forwardRef, type ReactElement } from "react";

import { cn } from "../cn.js";
import { Inline, Text } from "../atoms/index.js";
import { Dot, Fan, fanNamesItsEnds } from "../brand/index.js";
import type { FanEnd, FanOutcome, FanSize } from "../brand/index.js";
import { people, plural } from "../../format.js";

/**
 * ExplorationFan — a population exploring (ATOMIC-INVENTORY §3, organism 33; DESIGN-SYSTEM §8.6).
 *
 * Nine dashed béziers leaving one body and ending somewhere different: the product in one picture,
 * and the only piece of artwork in the system that is *about* a run rather than decorating one.
 * The geometry belongs to the brand layer — this organism draws none of it — and what it adds is
 * the two things the picture cannot say by itself.
 *
 * **A sentence.** The fan is `role="img"` and the sentence is its label, built with the product's
 * own counting words, so a reader who never sees the drawing is told the same thing: *"Nine people
 * went in: four filed a problem, three finished their errand, two gave up."* It reports what
 * happened and promises nothing about happening again (§7.3).
 *
 * **A legend, and the clay it does not always license.** `--pop-clay` appears nowhere else in the
 * product (§1.3 rule 3, §4.1): the `gaveUp` terminal is its one sanctioned use, the condition is
 * that it is at least 14px and **always beside a word**, and §4.1 is absolute that clay "may never
 * be anything at all inside `/app`". This organism has no route of its own to test, and it is used
 * on `NotFound` and in empty states as well as on the landing, so the licence is carried by the
 * picture instead: `fanNamesItsEnds()` — the brand `Fan`'s own condition for drawing its ends'
 * words, true at `hero` only. Where the fan names its ends, the terminal is clay and so is the
 * legend swatch; everywhere else both are `ink-muted`, the grammar's `left` — a person who walked
 * away. **The key and the thing it keys are painted by the same rule**, which is the whole point
 * of a key.
 *
 * **Lime obeys the lime law.** The `filed` swatch is the mark's "the one" dot — a lime fill
 * carrying the mandatory 1.5px ink ring in light, a 2px lime ring on transparent in dark (§5.4,
 * appearance 4) — and so, now, is the terminal dot it keys: the brand `Fan` spells that ending
 * with the same `theOne` classes, so neither is a second lime language and neither goes invisible
 * on paper. `done` is the hollow ring the grammar uses for an individual who is not the point.
 *
 * **One orchestrated moment, or none** (§5.1). `animate` is the landing hero's single piece of
 * motion; everywhere else — an empty state, a panel — it is left off and the picture is simply
 * there. Reduced motion is handled globally, and both the lines and the dots hold their final
 * frame.
 */

export interface ExplorationFanProps {
  ends: readonly FanEnd[];
  animate?: boolean;
  size?: FanSize;
}

/** What each ending is called when the caller has not named it. The product's own words. */
const OUTCOME_WORDS: Record<FanOutcome, { one: string; many: string }> = {
  filed: { one: "filed a problem", many: "filed a problem" },
  done: { one: "finished their errand", many: "finished their errand" },
  gaveUp: { one: "gave up", many: "gave up" },
};

/** Legend order: the finding first, because it is what the instrument is pointed at. */
const ORDER: readonly FanOutcome[] = ["filed", "done", "gaveUp"];

/**
 * The clay swatch. This is the one component in the product that may name `--pop-clay`, and the
 * reference is a CSS variable rather than a colour utility because the token is deliberately kept
 * out of Tailwind's colour namespace so `bg-clay` cannot be generated (§1.3 rule 3). 14px, which
 * is the floor §9.3 sets for it, and it is drawn only when the fan beside it is drawing clay too.
 */
const CLAY_SWATCH = "size-3.5 shrink-0 rounded-full [background:var(--pop-clay)]";

/** One swatch, painted by the rule that paints the terminal it keys. */
function Swatch({ outcome, clay }: { outcome: FanOutcome; clay: boolean }): ReactElement {
  if (outcome === "gaveUp") {
    // Clay only where the picture is allowed clay; otherwise the grammar's "walked away" dot,
    // which is the ink-muted fill the terminal takes in that case.
    return clay ? (
      <span aria-hidden="true" className={CLAY_SWATCH} />
    ) : (
      <Dot state="left" size="lg" />
    );
  }
  return <Dot state={outcome === "filed" ? "theOne" : "absent"} size="lg" />;
}

export const ExplorationFan = forwardRef<HTMLElement, ExplorationFanProps>(
  function ExplorationFan({ ends, animate = false, size = "panel" }, ref) {
    /** The fan draws its ends' words at `hero` only, and the word is the clay's one condition. */
    const clay = fanNamesItsEnds(ends, size);

    const counted = ORDER.map((outcome) => ({
      outcome,
      count: ends.filter((end) => end.outcome === outcome).length,
      /** A caller's own word for this ending wins over the default one. */
      label: ends.find((end) => end.outcome === outcome && end.label !== undefined)?.label,
    })).filter((entry) => entry.count > 0);

    const clauses = counted.map((entry) => {
      const words = OUTCOME_WORDS[entry.outcome];
      return `${entry.count} ${entry.count === 1 ? words.one : words.many}`;
    });

    const sentence =
      ends.length === 0
        ? "Nobody has gone in yet."
        : `${people(ends.length)} went in: ${clauses.join(", ")}.`;

    return (
      <figure ref={ref} className="m-0 min-w-0">
        <Fan ends={ends} animate={animate} size={size} label={sentence} />

        <figcaption className={cn("mt-4", size === "inline" ? "mt-2" : "")}>
          <Inline gap={4} wrap>
            {counted.map((entry) => (
              <span key={entry.outcome} className="flex items-center gap-1.5">
                <Swatch outcome={entry.outcome} clay={clay} />
                <Text size="meta" tone="muted">
                  {entry.label ?? OUTCOME_WORDS[entry.outcome].many}
                </Text>
                <Text size="meta" tone="ink">
                  {plural(entry.count, "person", "people")}
                </Text>
              </span>
            ))}
          </Inline>
        </figcaption>
      </figure>
    );
  },
);
