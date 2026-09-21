import { forwardRef, type ReactNode } from "react";

import { cn } from "../../cn.js";
import { Inline, Measure, Separator, Stack, Text } from "../../atoms/index.js";
import { Ledger, LedgerRow } from "../../organisms/index.js";
import { Capsule } from "../Capsule.js";
import { Dot } from "../Dot.js";
import { Lattice } from "../Lattice.js";
import type { LatticeDot } from "../Lattice.js";
import { ornamentSurface } from "../LatticeField.js";
import type { OrnamentGround } from "../LatticeField.js";
import { MARK_CELL_GAP, Ring, markPitch, markUnit } from "../Ring.js";
import type { BrandTone } from "../Ring.js";
import { DiagramFigure, type DiagramDetail, type DiagramSize } from "./Figure.js";

/**
 * ChainDiagram — the product's spine, drawn: **project → simulation → population → cohort →
 * person → visit → finding** (ADR-0029, CLAUDE.md "The chain").
 *
 * This is an explanation, not an ornament. A reader who has never seen the product should be
 * able to take the mechanism off the figure alone: what each link is, what it holds, and which
 * of them are *people* and which are the frames people are authored and run inside.
 *
 * **It is a ledger, because the product is a ledger** (§1.2 M2). Seven rows, a 72px right-aligned
 * stub carrying the link's shape, and one continuous spine — so the figure is visibly the same
 * instrument as the screens it explains, and so the shapes line up in a column a reader can scan
 * rather than being scattered across a row of cards. It also means the phone-width behaviour is
 * the ledger's own and is not invented here: below `--breakpoint-md` the stub collapses, each
 * shape becomes a leading line above its own row, and the chain reads as seven stacked blocks.
 *
 * **Two kinds of link, and the figure says which is which.** From `population` down, every link
 * is people, so it is drawn in the mark's own grammar (§8.6): a filled circle is one person, a
 * stadium of fused cells is a cohort, a lattice at pitch 31 is a population, a dashed 2/7 stroke
 * is a thing that has not happened yet. `project` and `simulation` are **containers** — a scope
 * you author inside and a thing you press go on — and there is no people-shape for either, so
 * they take the system's own container radius (§5.2, §1.2 M6) and are drawn as frames. Inventing
 * a brand glyph for them would have said "cohort" or "population" about something that is
 * neither, which is the one mistake this figure cannot afford.
 *
 * **`execution` is not a link and is not drawn as one.** A run is one *execution of a
 * simulation*, so it belongs inside the `simulation` row's sentence rather than in the chain —
 * and because outcomes vary between executions by design (ADR-0028/0030), the caption says so.
 * Nothing in this figure promises a repeatable result.
 *
 * **`on="forest"`** is §9.3/§9.9's one inverted band, and it is a *ground*, not a theme (the
 * `Logo` idiom). It is drawn by `ornamentSurface` from `LatticeField.js`, which is the one place
 * in the system that answers *which ink is legal on which ground* — this figure had its own copy
 * of that answer when the brand layer was built in parallel, and two copies of a ground is how a
 * band and the ornaments on it drift apart. The filled dots ask for `tone="ink"` so they resolve
 * through the same override. Nothing here asks TypeScript what the theme is.
 *
 * **Two axes, never one.** `size` is how much room the figure has; `detail` is how much of itself
 * it draws. Both are the folder's own unions, from `Figure.js`.
 */

/** The seven links, in order. Exported so a page can build its own anchors from the same list. */
export type ChainLink =
  | "project"
  | "simulation"
  | "population"
  | "cohort"
  | "person"
  | "visit"
  | "finding";

export const CHAIN_LINKS: readonly ChainLink[] = [
  "project",
  "simulation",
  "population",
  "cohort",
  "person",
  "visit",
  "finding",
];

/**
 * What each link is called, what it does to the next one, and what it is.
 *
 * The relation is the mechanism in two words — four of the seven *hold* the next link and two
 * *make* it, which is the real shape of the chain: composition down to a person, production from
 * a person onward. The definition is one sentence, in the serif, because it is the product
 * speaking (§3.2).
 */
const COPY: Record<ChainLink, { name: string; relation: string; definition: string }> = {
  project: {
    name: "Project",
    relation: "holds simulations",
    definition:
      "Everything you author lives in one project — targets, personas, cohorts, populations, simulations, settings, triage. None of it is shared across two.",
  },
  simulation: {
    name: "Simulation",
    relation: "holds a population",
    definition:
      "A population, a target and a mode. It is the thing you press go on, and each time you do it produces an execution.",
  },
  population: {
    name: "Population",
    relation: "holds cohorts",
    definition: "Composition and nothing else: an ordered set of cohorts.",
  },
  cohort: {
    name: "Cohort",
    relation: "holds people",
    definition:
      "People cast from one persona. It owns the headcount, the seed, and how often its people come back.",
  },
  person: {
    name: "Person",
    relation: "makes visits",
    definition:
      "A durable individual with a stored name and a detail line, written once and never silently overwritten.",
  },
  visit: {
    name: "Visit",
    relation: "files findings",
    definition:
      "One session: someone arrives, tries to get their errand done, and leaves — having filed a problem, finished, or given up.",
  },
  finding: {
    name: "Finding",
    relation: "what the chain is for",
    definition:
      "One problem, carrying the calls it rests on, so a verifier can replay it and you can check it.",
  },
};

/** The container frame: the system's own 12px container radius, drawn as a hairline (§5.2). */
const FRAME = "inline-flex items-center justify-center rounded-md border border-rule-strong";

/** Illustrative people. They carry no name, so the lattice around them is `aria-hidden`. */
function crowd(prefix: string, count: number, tone: BrandTone | undefined): LatticeDot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    state: "present" as const,
    label: "one person",
    tone,
  }));
}

/**
 * A cohort, drawn the way `CohortCapsule` draws one: a stadium of *n* fused cells laid **under**
 * a row of its own people, so the stadium's ends land on the first and last dot centres and its
 * length is the headcount (§8.6, amendment). The row's gap is the mark's 5 units expressed
 * against the dot token, which is what keeps the two the same length at every size.
 */
function CohortGlyph({ cells, tone }: { cells: number; tone: BrandTone | undefined }): ReactNode {
  return (
    <span
      className={cn(
        // Both properties, because the gap between two cells is `MARK_CELL_GAP` — the mark's own
        // pitch less its own diameter, read from what these two publish. `markUnit` alone leaves
        // `--mark-pitch` unset and the run closes up.
        markUnit({ size: "sm" }),
        markPitch({ size: "sm" }),
        "relative inline-flex items-center",
      )}
    >
      <Capsule cells={cells} size="sm" state="absent" className="absolute top-0 left-0" />
      <span className="relative flex items-center" style={{ gap: MARK_CELL_GAP }}>
        {Array.from({ length: cells }, (_, i) => (
          <Dot key={i} state="present" size="sm" tone={tone} />
        ))}
      </span>
    </span>
  );
}

/** One visit: a person, a session that is still open, and an ending. */
function VisitGlyph({ tone }: { tone: BrandTone | undefined }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      <Dot state="present" size="md" tone={tone} />
      <Separator weight="provisional" className="w-4" />
      <Ring size="md" />
    </span>
  );
}

/**
 * Every link's shape, at the one size a 72px locator column can afford.
 *
 * `tone` is `undefined` on the page — the states paint themselves — and `"ink"` on the forest
 * band, where `present`'s own `primary` is forest on forest. It is not passed to `theOne`, which
 * paints itself by construction and is the one shape in the figure that must not be recoloured.
 */
function glyphOf(link: ChainLink, tone: BrandTone | undefined): ReactNode {
  switch (link) {
    case "project":
      return (
        <span className={cn(FRAME, "p-1")}>
          <span className={cn(FRAME, "h-4 w-6 border-rule")} />
        </span>
      );
    case "simulation":
      return (
        <span className={cn(FRAME, "p-1")}>
          <Lattice dots={crowd("sim", 6, tone)} rows={2} size="sm" />
        </span>
      );
    case "population":
      return <Lattice dots={crowd("pop", 12, tone)} rows={4} size="sm" />;
    case "cohort":
      return <CohortGlyph cells={5} tone={tone} />;
    case "person":
      return <Dot state="present" size="lg" tone={tone} />;
    case "visit":
      return <VisitGlyph tone={tone} />;
    case "finding":
      return <Dot state="theOne" size="lg" />;
  }
}

export interface ChainDiagramProps {
  /** How much room the figure has. */
  size?: DiagramSize;
  /**
   * `full` draws each link's sentence; `compact` keeps the shape, the name and the relation and
   * drops the prose, for an aside or a rail.
   */
  detail?: DiagramDetail;
  /**
   * The ground the figure is set on — a *surface*, not a theme (§8.3's `Logo` idiom), and the
   * system's one word for the pair (`OrnamentGround`). `forest` is §9.9's single inverted band.
   */
  on?: OrnamentGround;
  /**
   * A route per link, where the figure is a way in. A link with one becomes the whole row; a
   * link without one is read, not clicked.
   */
  hrefs?: Partial<Record<ChainLink, string>>;
  id?: string;
  className?: string;
}

/**
 * The caption is not decoration: it is where the figure admits what it cannot draw. It names the
 * two links that are frames rather than people, and it states §7.3's rule outright, because a
 * diagram of a chain is exactly where a reader infers that running it twice gives the same
 * answer.
 *
 * **There is no `caption` prop, and that is §7.3 rather than an oversight.** Every figure in this
 * folder ends on the clause that keeps it honest — outcomes vary between executions by design,
 * and a problem that stops appearing is an absence rather than a repair — and a prop that
 * replaces the caption is a prop that deletes the clause. The six mechanism and honesty figures
 * never had one; these three did, and they do not now. A page that wants to say more says it in
 * its own prose beside the figure.
 */
const DEFAULT_CAPTION =
  "Everything from the population down is people, and is drawn in the mark's own grammar. A project and a simulation are frames people are authored and run inside, so they are drawn as frames. Pressing go on a simulation produces an execution, and what the people in it do varies between executions by design.";

export const ChainDiagram = forwardRef<HTMLElement, ChainDiagramProps>(function ChainDiagram(
  { size = "panel", detail = "full", on = "paper", hrefs, id, className },
  ref,
) {
  const tone: BrandTone | undefined = on === "forest" ? "ink" : undefined;

  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={cn(ornamentSurface({ on }), className)}
      name="Project to finding, in seven links"
      lede="The product's spine: what each link is, what it holds, and which of them are people rather than the frames people are authored and run inside."
      trailing={`${CHAIN_LINKS.length} links`}
      caption={DEFAULT_CAPTION}
    >
      <Ledger as="ol">
        {CHAIN_LINKS.map((link) => {
          const copy = COPY[link];
          return (
            <LedgerRow
              key={link}
              stub={<span aria-hidden="true">{glyphOf(link, tone)}</span>}
              stubKind="mark"
              to={hrefs?.[link]}
            >
              <Stack gap={1}>
                <Inline gap={2} align="baseline" wrap>
                  <Text size="name">{copy.name}</Text>
                  <Text size="meta" tone="muted">
                    {copy.relation}
                  </Text>
                </Inline>
                {detail === "full" ? (
                  <Measure width="read">
                    <Text as="p" size="read-sm" tone="soft">
                      {copy.definition}
                    </Text>
                  </Measure>
                ) : null}
              </Stack>
            </LedgerRow>
          );
        })}
      </Ledger>
    </DiagramFigure>
  );
});
