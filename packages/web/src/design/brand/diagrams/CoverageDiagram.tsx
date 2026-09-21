import { Fragment, forwardRef, type ReactNode } from "react";

import { plural } from "../../../format.js";
import { Badge, Inline, Meter, Mono, Spacer, Stack, Text } from "../../atoms/index.js";
import { ToolName } from "../../molecules/index.js";
import { Ledger, LedgerRow } from "../../organisms/index.js";
import { Dot } from "../Dot.js";
import { Ring } from "../Ring.js";
import { DiagramKey } from "./DiagramKey.js";
import { DiagramFigure, type DiagramSize } from "./Figure.js";

/**
 * CoverageDiagram — which of the target's tools the population actually reached, which it never
 * touched, and which one the product's own copy promises and the target does not expose
 * (DESIGN-SYSTEM §7.3, §8.6, §9.3–§9.6; ADR-0030).
 *
 * **A coverage gap is a finding kind in this product, not a footnote.** `coverage-gap` sits in
 * the same union as `bug` and `friction`, it clusters, it carries a signature and it is triaged
 * like anything else — because the most expensive thing a product can have is a capability its
 * own copy promises and its surface does not offer.
 *
 * **The figure is grouped, and the groups are the explanation.** Three labelled runs — reached,
 * exposed and never touched, promised and not exposed — each carrying its own count, so the
 * three readings are named *inside* the picture rather than in a paragraph under it (§9.3). The
 * earlier version sorted the same rows into one undifferentiated ledger and spent two paragraphs
 * and a summary line explaining the order; the groups say it in three labels.
 *
 * **The mark carries the meeting between a person and a tool.** A filled dot where the population
 * reached it, a ring where nobody did — the grammar's own sentence (§8.6). The content column
 * carries the real `ToolName`, the call count and a `Meter` against the busiest tool, so the
 * *shape* of the usage is visible: forty calls to one tool and three to another is the fact that
 * makes a zero interesting.
 *
 * **The row that is not like the others** is the promised-and-missing one. It gets no meter,
 * because there is nothing to measure, and its name prints in full with `— not exposed` beside
 * it: evidence is never decorated away and a strikethrough is not a statement (§4.2).
 *
 * **What this figure must never imply.** That coverage is a fixed property of a product. It is
 * measured per execution and it moves with the cast (ADR-0030), so a tool nobody reached this
 * time is not a tool nobody will ever reach. The caption says that in those words, because a
 * coverage table is exactly where a reader is tempted to read a repeatable number.
 *
 * **The tool names are generic on purpose.** `create_item`, `search`, `delete_item` — a reader
 * should recognise the shape of their own tool list in it at a glance, which a name out of any
 * particular app defeats. A caller with a real `coverage.items` passes its own, and the
 * `illustrative` marker on the rule disappears when they do.
 *
 * **Degradation.** Below `md` the ledger stub collapses and the mark becomes a leading line above
 * its row (§1.2 M2); the meter and the counts stay full width. No row depends on the mark alone —
 * a tool nobody reached carries the words in a badge — so the figure reads at any width and in
 * greyscale.
 */

/**
 * One tool's row.
 *
 * The three fields are the ones `ToolUsage` already carries under the same names, so a caller
 * holding a real `coverage.items` entry can pass it straight in; this shape is narrower on
 * purpose rather than different, because a figure has no business rendering `firstUsedAt` or a
 * destructive hint.
 */
export interface CoverageTool {
  name: string;
  /** How many times the population called it. `0` is the point of this figure. */
  calls: number;
  /**
   * Whether the target exposes it at all. `false` is the promised-and-missing row: the product's
   * own copy offers the capability and no tool in the target delivers it.
   */
  exposed?: boolean;
}

/**
 * An example tool surface — the shape most apps have, under names anyone recognises, with a
 * promised-and-missing row last. Numbers are illustrative; the figure says so on its own rule.
 */
const SAMPLE_TOOLS: readonly CoverageTool[] = [
  { name: "create_item", calls: 58 },
  { name: "list_items", calls: 41 },
  { name: "search", calls: 23 },
  { name: "update_item", calls: 17 },
  { name: "sign_up", calls: 12 },
  { name: "add_comment", calls: 3 },
  { name: "upgrade_plan", calls: 0 },
  { name: "export_data", calls: 0 },
  { name: "delete_item", calls: 0, exposed: false },
];

/** A tool the target does not offer cannot be reached, so it is never counted as untouched. */
function isExposed(tool: CoverageTool): boolean {
  return tool.exposed !== false;
}

/** The three readings, in the order a reader needs them, each with the count in its own label. */
function group(tools: readonly CoverageTool[]): readonly {
  key: string;
  label: string;
  rows: readonly CoverageTool[];
}[] {
  const busiestFirst = (a: CoverageTool, b: CoverageTool): number => b.calls - a.calls;
  const reached = tools.filter((tool) => isExposed(tool) && tool.calls > 0).sort(busiestFirst);
  const untouched = tools.filter((tool) => isExposed(tool) && tool.calls === 0);
  const missing = tools.filter((tool) => !isExposed(tool));

  return [
    { key: "reached", label: `${plural(reached.length, "tool")} reached`, rows: reached },
    { key: "untouched", label: `${untouched.length} exposed, never touched`, rows: untouched },
    { key: "missing", label: `${missing.length} promised, not exposed`, rows: missing },
  ].filter((band) => band.rows.length > 0);
}

export interface CoverageDiagramProps {
  /** The target's tools and what this execution did with them. Defaults to an example surface. */
  tools?: readonly CoverageTool[];
  /** The execution these calls were counted in, for the sentence that scopes the reading. */
  execution?: number;
  size?: DiagramSize;
  id?: string;
  className?: string;
}

export const CoverageDiagram = forwardRef<HTMLElement, CoverageDiagramProps>(
  function CoverageDiagram(
    { tools = SAMPLE_TOOLS, execution = 1, size = "panel", id, className },
    ref,
  ) {
    const rows = tools;
    const bands = group(rows);
    const busiest = rows.reduce((most, tool) => Math.max(most, tool.calls), 0);
    /**
     * The promised-and-missing rows, named in the caption. Read off the data rather than
     * written into the sentence: a caller passing a real `coverage.items` would otherwise get
     * a caption naming a tool that is not in their figure.
     */
    const missing = rows.filter((tool) => !isExposed(tool));

    return (
      <DiagramFigure
        ref={ref}
        id={id}
        size={size}
        className={className}
        sample={tools === SAMPLE_TOOLS}
        name="What the population reached"
        lede="Every tool your app exposes, what one execution's people did with it, and the capability your copy promises that your tools do not offer."
        trailing={`execution ${execution}`}
        caption={
          <>
            <Text as="p" size="read" tone="ink">
              Coverage moves with the cast. A tool nobody reached this time is not a tool nobody
              will ever reach.
            </Text>
            {missing.length === 0 ? null : (
              <Text as="p" size="read-sm" tone="soft" className="mt-2">
                The last band is the one that does not move for that reason:{" "}
                {missing.map((tool, i) => (
                  <Fragment key={tool.name}>
                    {i === 0 ? null : ", "}
                    <Mono size="code-sm">{tool.name}</Mono>
                  </Fragment>
                ))}{" "}
                {missing.length === 1 ? "is" : "are"} not there to be reached at all. That is
                filed as a finding, with the people who went looking for it attached.
              </Text>
            )}
          </>
        }
      >
        <Stack gap={6}>
          {bands.map((band) => (
            <Stack key={band.key} gap={2}>
              <Text size="label" tone="muted">
                {band.label}
              </Text>
              <Ledger as="ul" stubKind="mark">
                {band.rows.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} busiest={busiest} />
                ))}
              </Ledger>
            </Stack>
          ))}

          {/*
            The key. Shape first, word second — the marks in the stub repeat what each band
            label already says in words, so nothing rests on a colour or on a shape alone (§4.2).
          */}
          <DiagramKey
            ruled
            items={[
              {
                id: "reached",
                glyph: <Dot state="present" size="sm" />,
                label: "somebody went there",
              },
              { id: "untouched", glyph: <Ring size="sm" />, label: "nobody did" },
            ]}
          />
        </Stack>
      </DiagramFigure>
    );
  },
);

/**
 * One tool: the mark in the locator column, the name, the count, and the bar that gives the
 * count a scale. The bar is against the busiest tool, so a tool reached once and a tool reached
 * forty times are visibly not the same "covered".
 */
function ToolRow({ tool, busiest }: { tool: CoverageTool; busiest: number }): ReactNode {
  const gap = !isExposed(tool);
  const touched = tool.calls > 0;
  const sentence = gap
    ? `${tool.name} is not exposed by the target.`
    : touched
      ? `${tool.name}: ${plural(tool.calls, "call")}, against ${busiest} for the busiest tool.`
      : `${tool.name}: nobody reached it.`;

  return (
    <LedgerRow
      density="tight"
      stub={
        touched ? (
          <Dot state="present" size="sm" label="somebody went there" />
        ) : (
          <Ring size="sm" label="nobody did" />
        )
      }
    >
      <div className="grid gap-1.5">
        <Inline gap={2} align="baseline" wrap>
          <ToolName name={tool.name} missing={gap} />
          <Spacer />
          {touched ? (
            <Text size="meta" tone="muted">
              {plural(tool.calls, "call")}
            </Text>
          ) : (
            <Badge variant="kind">{gap ? "coverage gap" : "no calls"}</Badge>
          )}
        </Inline>
        {/*
          No meter on the missing row. A track drawn at zero says "measured, and it came out as
          none"; there was nothing here to measure, and the difference between those two zeroes
          is the whole reason this row exists.
        */}
        {gap ? null : (
          <Meter value={tool.calls} of={Math.max(busiest, 1)} tone="measure" size="sm" label={sentence} />
        )}
      </div>
    </LedgerRow>
  );
}
