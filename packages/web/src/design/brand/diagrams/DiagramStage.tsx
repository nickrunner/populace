import { forwardRef, type ReactNode } from "react";

import { Heading, Mono, Stack } from "../../atoms/index.js";

/**
 * DiagramStage — one numbered step of a figure (DESIGN-SYSTEM §8.6, §9.2, §9.3).
 *
 * A heading, and under it whatever proves the heading: a sentence from `DiagramSays`, a real
 * `PayloadBlock`, a real `FindingCard`, a nested `Ledger` of call refs. Three of the nine
 * diagrams declared a private `Stage` with this exact body when the folder was built in parallel,
 * two of them identically, so it is one component here.
 *
 * ---------------------------------------------------------------------------------------------
 * **THE STAGE RAIL IS GONE, AND THIS IS THE REASONING.**
 *
 * A stage used to be a `LedgerRow` inside a `Ledger`, so the four stages of a figure hung off
 * M2's continuous spine with the ordinal in the 72px stub. `MarketingShell` had already had that
 * same hairline taken off it (§9.2): a spine is the right edge of a *column of locators*, and a
 * marketing page has none, so the line aligned nothing and read as a rule struck down the page
 * past every heading. Moving the rule inside a `<figure>` did not change any of that — it only
 * made it shorter. On `/how-it-works` this component's surviving spine measured **1,673px** tall
 * beside five in-figure headings, and on `/use-cases` **1,183px**; it cleared the headings by an
 * 11px gutter, which is the letter of the fix and not its point.
 *
 * So there is **no rule here at all**, and a stage indents to nothing. What the
 * rail was actually for — *this is step 01 of a sequence* — is carried by a **numbered eyebrow**:
 * the ordinal set in the machine's face at the `ref` step, directly above the name it numbers.
 * That is not a new device. `StepStrip` already heads the landing page with exactly it, for
 * exactly this reason ("the ordinals sequence it", §1.2 M2), and `t-ref` is the step §3.4 names
 * for a position, so the ordinal reads as the same typographic object it was in the stub — only
 * without a column, because there is no second column to draw.
 *
 * **No glyph joins it**, and that is deliberate rather than an omission. §8.6's grammar has a
 * word for a person, a cohort, a population, a finding and a severity reading; it has none for
 * *a step*, and a filled circle beside an ordinal would say "a person who was there" about a
 * stage. §1.3 rule 4 forbids a glyph carrying meaning on its own, so the number carries it.
 *
 * `LedgerSpine` itself is untouched and stays right where it is earning its keep — the
 * transcript, the findings list, the executions history — where a stub column of locators
 * genuinely needs an alignment edge. **Nor is every figure spine gone**, and the distinction is
 * row height rather than the word `figure`: where a figure embeds a real `Ledger` whose rows are
 * a line or two, the spine is still the edge of something a reader scans, and `ChainDiagram`'s
 * seven 48–65px links (366px) and `CoverageDiagram`'s six 46px capabilities (276px) keep it.
 * `VarianceDiagram`'s 144px rows did not, and it is drawn `spine={false}`. A stage is the extreme
 * case of that — a stage is a heading with an artefact under it, hundreds of pixels tall — so it
 * is not a ledger row at all. §9.2 states the threshold a reviewer measures.
 * ---------------------------------------------------------------------------------------------
 *
 * **`n` decides the element, and that is the whole of the variance.** With a position — `"01"`,
 * `"02"` — the stage is an `<li>` and must sit in a `Stack as="ol">`, so the sequence the eyebrow
 * prints is the sequence the document has. Without one it is a plain `<section>`, for a figure
 * whose stages are full-measure artefacts separated by a `DiagramFlow` instead —
 * `EvidenceDiagram`'s shape, where the steps are named rather than numbered.
 *
 * The heading is always `level={3}` at `size="name"`: a stage sits under the figure's own name,
 * which the `DiagramFigure` frame sets in `t-eyebrow`, and it is a **name** rather than a
 * sentence, so it takes the sans (§3.1).
 */
export interface DiagramStageProps {
  /**
   * The stage's position in the sequence, as it is printed — `"01"`, `"02"`. Given, the stage is
   * an `<li>` and must sit inside a `Stack as="ol">`; omitted, it is a `<section>`.
   */
  n?: string;
  /** The stage's name. Sans, because it names rather than says (§3.1). */
  title: string;
  /** The sentence and the artefact that prove the heading. */
  children: ReactNode;
}

export const DiagramStage = forwardRef<HTMLElement, DiagramStageProps>(function DiagramStage(
  { n, title, children },
  ref,
) {
  const body = (
    <Stack gap={3}>
      {/*
        The ordinal and the name are one block — `gap={1}`, tighter than the gap to the artefact
        below — so the number reads as this heading's eyebrow rather than as a loose locator
        floating between two stages.
      */}
      <Stack gap={1}>
        {n === undefined ? null : (
          <Mono size="ref" tone="muted">
            {n}
          </Mono>
        )}
        <Heading level={3} size="name">
          {title}
        </Heading>
      </Stack>
      {children}
    </Stack>
  );

  if (n === undefined) {
    return <section ref={ref}>{body}</section>;
  }

  /**
   * A callback ref: the element is an `<li>` here and a `<section>` above, and one
   * `ForwardedRef<HTMLElement>` cannot be handed to both slots. Contravariance makes a callback
   * taking the widest element type assignable to either.
   */
  return (
    <li
      ref={(node) => {
        if (typeof ref === "function") ref(node);
        else if (ref !== null) ref.current = node;
      }}
    >
      {body}
    </li>
  );
});
