import { forwardRef } from "react";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Text } from "../atoms/index.js";

/**
 * PairingsGrid — targets down, populations across, and what has been sent where.
 *
 * **A simulation is a pairing.** One target, one population, one mode. Once a project holds more
 * than one of either, the interesting question stops being "what have I run" and becomes "what
 * have I NOT run" — the same cast at qa as at dev is how you learn a problem is environmental
 * rather than real, and that is the whole argument for a project holding several targets. A flat
 * list of twelve simulations cannot answer it; a grid answers it at a glance.
 *
 * **It is called Pairings and not Coverage, deliberately.** "Coverage" already means tool coverage
 * in this product, one click down, on a screen whose rail item reads "Coverage gaps" — how much of
 * the target's tool list anybody actually touched. Two meanings of one word one click apart is the
 * kind of thing that makes a product feel arbitrary. For the same reason an empty cell here is
 * **not tried**, never "a gap": a pairing nobody has run is a thing you might do, not a hole.
 *
 * **An empty cell is a link that makes the pairing.** `s/new?target=&population=` seeds both
 * choices, so the grid is not a readout you then have to act on somewhere else — the cell IS the
 * act. A filled cell counts the simulations pairing those two and goes to the first of them.
 *
 * Nothing here promises what an execution would find (§7.3): a cell says how many simulations
 * pair the two, and never how many problems are "left".
 */

export interface PairingAxis {
  id: string;
  name: string;
}

export interface PairingsGridProps {
  /** The rows. One per target, in the order the project lists them. */
  targets: readonly PairingAxis[];
  /** The columns. One per population. */
  populations: readonly PairingAxis[];
  /**
   * Every simulation, as the pairing it stands for. The grid counts them into cells; it does not
   * fetch and it does not know what a simulation is beyond these three fields.
   */
  simulations: readonly { id: string; slug: string; targetId: string; populationId: string }[];
  /** `href("s/new")`-style builder. The grid appends the two ids as query parameters. */
  newSimulationHref: string;
  /** Where one simulation lives, by slug. */
  simulationHref: (slug: string) => string;
}

/**
 * A cell. Square-ish, ruled rather than boxed (§1.4 — the ground is ruled, not empty), and the
 * whole cell is the hit area because a 1-character link in the middle of a 64px box is a target
 * nobody can aim at.
 */
const cell = cn(
  "flex min-h-14 items-center justify-center bg-[var(--pairing-ground)] px-3 py-2",
  "t-ui text-ink-soft hover:bg-hover hover:text-ink",
  pressTransition,
  focusRing,
);

export const PairingsGrid = forwardRef<HTMLDivElement, PairingsGridProps>(function PairingsGrid(
  { targets, populations, simulations, newSimulationHref, simulationHref },
  ref,
) {
  const tried = simulations.length;
  const total = targets.length * populations.length;

  return (
    <div ref={ref}>
      {/*
        One hairline grid: `gap-px` over a `rule` ground with opaque cells, which is the same
        recipe `StatGroup ruled` uses. It draws lines BETWEEN cells and never at an edge, at any
        column count, with no `nth-child` arithmetic.

        `overflow-x-auto` because the column count is the number of populations and that is the
        user's business, not a number this component can wrap. `--pairing-ground` is seeded from
        the focus-ring separator channel and falls back to the page, exactly as the stat strip's
        `--stat-ground` does.
      */}
      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-px bg-rule [--pairing-ground:var(--focus-sep,var(--color-bg))]"
          style={{ gridTemplateColumns: `minmax(8rem,auto) repeat(${String(populations.length)}, minmax(6rem,1fr))` }}
          role="table"
          aria-label="Which populations have been sent at which targets"
        >
          {/* The corner, and the column headings. */}
          <div className="bg-[var(--pairing-ground)] px-3 py-2" />
          {populations.map((population) => (
            <div key={population.id} className="bg-[var(--pairing-ground)] px-3 py-2" role="columnheader">
              <Text size="label" tone="muted" truncate>
                {population.name}
              </Text>
            </div>
          ))}

          {targets.map((target) => (
            <Row
              key={target.id}
              target={target}
              populations={populations}
              simulations={simulations}
              newSimulationHref={newSimulationHref}
              simulationHref={simulationHref}
            />
          ))}
        </div>
      </div>

      {/*
        The one sentence under it. It counts what HAS been paired against what could be, and says
        nothing at all about what any of it found.
      */}
      <Text size="meta" tone="muted" as="div" className="mt-3">
        {total === tried
          ? `Every pairing has a simulation.`
          : `${String(total)} pairings, ${String(tried)} simulated. An empty cell is one nobody has tried.`}
      </Text>
    </div>
  );
});

function Row({
  target,
  populations,
  simulations,
  newSimulationHref,
  simulationHref,
}: {
  target: PairingAxis;
  populations: readonly PairingAxis[];
  simulations: PairingsGridProps["simulations"];
  newSimulationHref: string;
  simulationHref: (slug: string) => string;
}) {
  return (
    <>
      <div className="flex items-center bg-[var(--pairing-ground)] px-3 py-2" role="rowheader">
        <Text size="ui" truncate>
          {target.name}
        </Text>
      </div>
      {populations.map((population) => {
        const here = simulations.filter(
          (s) => s.targetId === target.id && s.populationId === population.id,
        );
        const first = here[0];
        const to =
          first === undefined
            ? `${newSimulationHref}?target=${encodeURIComponent(target.id)}&population=${encodeURIComponent(population.id)}`
            : simulationHref(first.slug);
        return (
          <RouterLink
            key={population.id}
            to={to}
            className={cell}
            aria-label={
              first === undefined
                ? `Send ${population.name} at ${target.name} — not tried yet`
                : `${String(here.length)} ${here.length === 1 ? "simulation pairs" : "simulations pair"} ${population.name} with ${target.name}`
            }
          >
            {/*
              The count, or an em dash for a pairing nobody has tried. A dash and not a nought:
              nought is a measurement and this is an absence, and §7.3's honesty rule is about
              exactly this distinction elsewhere in the product.
            */}
            {here.length === 0 ? (
              <Text size="ui" tone="muted" aria-hidden>
                —
              </Text>
            ) : (
              <Text size="ui" aria-hidden>
                {here.length}
              </Text>
            )}
          </RouterLink>
        );
      })}
    </>
  );
}
