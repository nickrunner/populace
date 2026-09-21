import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { Capsule } from "./Capsule.js";
import { Dot } from "./Dot.js";
import { Fan } from "./Fan.js";
import type { FanEnd } from "./Fan.js";
import { Lattice } from "./Lattice.js";
import type { LatticeDot } from "./Lattice.js";

/**
 * StepStrip — **a whole walkthrough in one row** (DESIGN-SYSTEM §1.2 M4, §8.6, §9.3).
 *
 * Five beats, each a mark-grammar shape, a name and five or six words. It exists to head a page
 * where a numbered stack of paragraphs used to: a reader who wants to know what this product
 * does gets the arc from the shapes alone, and a reader who wants the mechanism goes on to the
 * figures in `diagrams/` that draw each beat in full.
 *
 * **The numbers are legitimate here, and only here.** A tracked-out `01 / 02 / 03` over three
 * unrelated feature cards is the commonest generated-design tell there is. This is an actual
 * sequence — nothing can be filed before somebody has visited, and nothing is clustered before
 * it is filed — so the ordinals carry information, and they are set in the machine's face at the
 * `ref` step, which is the same treatment the ledger's locator column uses (§1.2 M2).
 *
 * **No vertical rules, and that is a correction** (§9.2). An earlier reading of this system ran a
 * spine down the whole of every marketing page, where it aligned nothing and cut across each
 * heading at a fixed offset. A strip of five equal cells needs no dividers at all: the ordinals
 * sequence it and one hairline above the row grounds it, which is §1.4's *"the ground is ruled,
 * not empty"* paid for with a single line rather than six.
 *
 * **Paper only, deliberately.** There is no `on` prop. Every default glyph here is drawn in the
 * mark's `present` state, which is `--color-primary` — and `primary` in the light theme *is* the
 * forest the landing's one inverted band is made of (§9.9). A forest variant would need a second
 * set of paints for the grammar, which is the kind of second vocabulary this layer exists to
 * prevent. The band has the chain diagram; this strip has the paper.
 *
 * **Nothing animates.** §5.1 allows the landing exactly one orchestrated motion and it belongs to
 * the hero's fan. The fan inside step three is drawn static, so a `prefers-reduced-motion` reader
 * and everybody else see the same strip.
 */

/** The strip's five cells, and the two it collapses to on a phone. */
const strip = cva("m-0 grid list-none p-0", {
  variants: {
    /** A hairline above the row — the strip's ground, and its only rule. */
    ruled: {
      true: "border-t border-rule pt-6",
      false: "",
    },
  },
  defaultVariants: { ruled: true },
});

/** One beat of the sequence. */
export interface StepStripItem {
  /** A stable key, and the beat's own name — `"compose"`, `"digest"`. */
  id: string;
  /** The step. Sans, sentence case: it names an action rather than says something (§3.1). */
  title: string;
  /** What happens in it. Five or six words — a caption, never a sentence with a comma in it. */
  note: string;
  /**
   * The beat, drawn in the mark's grammar (§8.6). Pass a real primitive with **no `label`**: the
   * title beside it is the label, and a `<title>` here would have a screen reader read the strip
   * twice.
   */
  glyph: ReactNode;
}

/** Eight dots, four high: the mark's own shape for an ordered set of people (§1.2 M4). */
const POPULATION: readonly LatticeDot[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i}`,
  state: "present",
  label: "a person",
}));

/**
 * Five visits, and the three endings the product has (§8.6). Unlabelled, so the clay ending is
 * drawn in `ink-muted` rather than in clay — the word is the licence, and at glyph size there is
 * no room for the word (§4.1, §9.3).
 */
const EXPLORING: readonly FanEnd[] = [
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "gaveUp" },
  { outcome: "filed" },
];

/**
 * A graduated reading, lit from the bottom — the severity column of §1.2 M3, at glyph size. Two
 * lit and two unlit, because a digest that is all critical is not a digest.
 */
const SEVERITY: readonly LatticeDot[] = [
  { id: "s4", state: "absent", label: "nothing at this level" },
  { id: "s3", state: "absent", label: "nothing at this level" },
  { id: "s2", state: "present", tone: "high", label: "problems at this level" },
  { id: "s1", state: "present", tone: "medium", label: "problems at this level" },
];

/**
 * The product's arc, in the words a user of it would use (§7.1). No target is named and none can
 * be: the strip describes what the reader does, and the reader's app is the only app in it.
 */
export const DEFAULT_STEPS: readonly StepStripItem[] = [
  {
    id: "compose",
    title: "Compose people",
    note: "personas, in cohorts",
    glyph: <Capsule cells={3} size="lg" />,
  },
  {
    id: "send",
    title: "Point them at your app",
    note: "one simulation, one target",
    glyph: <Lattice dots={POPULATION} size="sm" />,
  },
  {
    id: "visit",
    title: "They try to get something done",
    note: "no script, no tour",
    glyph: <Fan ends={EXPLORING} size="inline" origin="dot" className="w-14" />,
  },
  {
    id: "file",
    title: "What stops them is filed",
    note: "with the calls that caused it",
    glyph: <Dot state="theOne" size="lg" />,
  },
  {
    id: "digest",
    title: "You read the digest",
    note: "verified, and grouped",
    glyph: <Lattice dots={SEVERITY} size="sm" />,
  },
];

export interface StepStripProps {
  /** The beats. Defaults to the product's own five; two to five read well in the row. */
  steps?: readonly StepStripItem[];
  /** The hairline above the row. Default on — a strip with no ground floats (§1.4). */
  ruled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export const StepStrip = forwardRef<HTMLOListElement, StepStripProps>(function StepStrip(
  { steps = DEFAULT_STEPS, ruled = true, id, className, style },
  ref,
) {
  return (
    <ol
      ref={ref}
      id={id}
      className={cn(
        strip({ ruled }),
        // Five tracks at `lg`, two on a tablet, one on a phone. The row gap is larger than the
        // column gap because a wrapped strip must read as rows of beats and not as a block.
        "gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5",
        className,
      )}
      style={style}
    >
      {steps.map((step, i) => (
        <li key={step.id} className="grid content-start gap-2">
          {/*
            A fixed glyph band so five shapes of five different heights all sit on one baseline
            and the names below them line up across the row. `items-end` rather than centre: the
            shapes hang off the same line the ordinal does.
          */}
          <span aria-hidden="true" className="flex h-10 items-end">
            {step.glyph}
          </span>

          <span className="t-ref text-ink-muted">{String(i + 1).padStart(2, "0")}</span>

          <span className="t-name text-ink">{step.title}</span>

          <span className="t-meta text-ink-muted">{step.note}</span>
        </li>
      ))}
    </ol>
  );
});
