import { forwardRef, type ReactNode } from "react";

import { Measure, Mono, Text } from "../../atoms/index.js";
import type { LatticeDot } from "../Lattice.js";
import { Capsule } from "../Capsule.js";
import { Lattice } from "../Lattice.js";
import { StatFigure } from "../StatFigure.js";
import { DiagramFlow } from "./DiagramFlow.js";
import { DiagramFigure, EXECUTIONS_ARE_INDEPENDENT, type DiagramSize } from "./Figure.js";

/**
 * GapDiagram — **the one sentence this product is for, drawn** (DESIGN-SYSTEM §1.2 M4, §8.6,
 * §9.3).
 *
 * *The tool exists. Can people find it?* Two beats and a number. On the left the capability, in
 * the surface, working: the mark's capsule, filled, with the tool's own name under it in the
 * machine's face. On the right the only reading that matters — how many of the people who wanted
 * it arrived at it — with each of those people drawn as a dot, most of them rings.
 *
 * **It is the class of problem an assertion is structurally unable to hold.** A test calls the
 * tool directly. A person has to find it first, and the finding-it is the step no assertion
 * takes, which is why the left half of this picture is entirely green and the right half is
 * entirely empty and *both are true at once*. That contradiction is the figure; everything else
 * here is a label on it.
 *
 * **The people are drawn, never counted** (§1.2 M4). Twelve rings is a reading a reader has
 * before the number under it resolves, and a bar at 0% would say "measured, and it came out as
 * none" about a set of individuals. The `Lattice` here is the same component the dashboard's
 * roster is, so the drawing cannot drift from the product.
 *
 * **Generic by construction.** The default tool name is `export_report`, which is a thing a task
 * app, a booking tool and a CRM all plausibly have. No figure in this folder names a target, and
 * a caller with a real one passes it: the argument is about the shape of the problem, not about
 * anybody's product.
 *
 * **What it must never imply** (§7.3, ADR-0028/0030). That the zero is a property of the surface.
 * A different cast takes a different route, so the count moves between executions — the caption
 * carries §7.3's own sentence verbatim rather than a softer one, and while the figure is drawing
 * its own authored numbers `sample` prints *illustrative* on its rule. Pass a real tool and a
 * real pair of counts and the marker goes, which is the folder's one rule for that word (§9.6).
 *
 * **Degradation.** Three tracks at `md` — the capability, the connector, the reading — and a
 * stack below it, where `DiagramFlow` turns its rule through ninety degrees on its own. Neither
 * half depends on the other's position: each carries its own label and its own sentence.
 */

/**
 * The figure's own example. A task app, a booking tool and a CRM all plausibly have a reporting
 * export, and none of them is anybody's product — which is the whole requirement for a default
 * here. The three are module constants rather than inline defaults so `sample` can be computed
 * against them, exactly as `CompositionDiagram` and `PersonDiagram` compute theirs.
 */
const SAMPLE_TOOL = "export_report";
const SAMPLE_PEOPLE = 12;
const SAMPLE_FOUND = 0;

export interface GapDiagramProps {
  /**
   * The capability, named as the machine names it. Generic on purpose — this is an example of a
   * shape, not a claim about a product (§9.4).
   */
  tool?: string;
  /** How many people had a reason to want it. Drawn, one dot each (§1.2 M4). */
  people?: number;
  /** How many of them arrived at it. `0` is the case the figure is built around. */
  found?: number;
  size?: DiagramSize;
  id?: string;
  /**
   * The mechanism, after the picture. The default is the punch line and §7.3's clause, and
   * nothing else; `null` drops it for a page that says it in its own words.
   */
  caption?: ReactNode;
  className?: string;
}

export const GapDiagram = forwardRef<HTMLElement, GapDiagramProps>(function GapDiagram(
  {
    tool = SAMPLE_TOOL,
    people = SAMPLE_PEOPLE,
    found = SAMPLE_FOUND,
    size = "panel",
    id,
    caption,
    className,
  },
  ref,
) {
  const total = Math.max(1, Math.round(people));
  const arrived = Math.min(total, Math.max(0, Math.round(found)));

  const dots: readonly LatticeDot[] = Array.from({ length: total }, (_, i) => ({
    id: `person-${i}`,
    state: i < arrived ? "present" : "absent",
    label: i < arrived ? "found it" : "never found it",
  }));

  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={className}
      name="The gap an assertion cannot hold"
      lede="The tool exists. Can people find it?"
      sample={tool === SAMPLE_TOOL && people === SAMPLE_PEOPLE && found === SAMPLE_FOUND}
      caption={
        caption === undefined ? (
          <>
            <Text as="p" size="read" tone="ink">
              A test calls the tool directly. A person has to find it first, and finding it is the
              step no assertion takes.
            </Text>
            <Text as="p" size="meta" tone="muted" className="mt-2">
              {EXECUTIONS_ARE_INDEPENDENT}
            </Text>
          </>
        ) : (
          caption
        )
      }
    >
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
        {/*
          The capability. A capsule is the mark's word for individuals merged into one body, and
          here it is the fused run of cells a working feature occupies in the surface (§8.6).
        */}
        <div className="grid justify-items-start gap-3">
          <Text size="label" tone="muted">
            In your surface
          </Text>
          <Capsule cells={3} size="lg" label="the capability is there, and it works" />
          <Mono size="code-sm">{tool}</Mono>
          <Measure as="p" width="read">
            <Text size="read-sm" tone="soft" as="span">
              It ships, it works, and every assertion about it passes.
            </Text>
          </Measure>
        </div>

        <DiagramFlow label="and yet" />

        {/*
          The reading. `StatFigure` is the system's one marketing number, so the figure here is
          the same step, the same tabular numerals and the same rule as every other one on the
          page — and its `drawing` slot is where M4's "any count of people is drawn" is paid.
        */}
        <StatFigure
          label="people who found it"
          value={`${arrived} of ${total}`}
          drawing={
            <Lattice
              dots={dots}
              size="md"
              label={`${total} people wanted it; ${arrived} arrived at it.`}
            />
          }
          note="Each ring is somebody who went looking and got somewhere else."
        />
      </div>
    </DiagramFigure>
  );
});
