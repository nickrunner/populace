import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { Heading, Inline, Measure, Text } from "../atoms/index.js";
import { textStyles } from "../atoms/Text.js";
import { Breadcrumb, MetaLine } from "../molecules/index.js";
import type { Crumb, MetaFact } from "../molecules/index.js";

/**
 * PageHeader — ATOMIC-INVENTORY §3, organism 3. 21 sites: the existing `PageHeader` plus the
 * five screens that bypass it.
 *
 * **It owns the single `<h1>`, and the `actions` slot is why it now gets to.** Five screens
 * hand-roll an `<h1>` today for no reason other than that the shared header had nowhere to put a
 * button; the result is five heading orders the shared component cannot guarantee. Everything
 * those screens needed is a prop here, so nothing has to opt out (§6, "Heading order").
 *
 * The stack, top to bottom, is §1.2's M1 — *three voices, one grammar* — at page scale:
 *
 *   crumbs      sans, quiet, `aria-current` on where you are        (Breadcrumb)
 *   eyebrow     12px sentence case — what KIND of record this is
 *   title       sans `t-title`: a NAME, and the document's only h1
 *   meta        facts separated by a hairline, never a middle dot   (MetaLine)
 *   lede        serif `t-lede` at `--measure-lede`: a SENTENCE
 *
 * Four registers before the content starts and not one box drawn.
 *
 *  - **The eyebrow-to-title gap is `EYEBROW_TITLE_GAP`, and it is §3.7's fifth pairing.** §3.7
 *    ships `.t-eyebrow + .t-title { margin-top: 12px }` for the DOM-sibling case and four named
 *    `eyebrow-*` utilities for the four serif pairings; neither reaches here, because `status`
 *    has to sit on the title's line and the flex row that puts it there breaks the adjacency
 *    selector, and because eyebrow-over-title is sans over sans and so is not one of the four.
 *    So the 12px is written once, in a constant that names the section it comes from, rather
 *    than inline where the next reader would take it for an arbitrary `mt-3`. §3.7 has been
 *    amended to record the pairing and to say that this constant is where it lives.
 *  - **`lede` is `ink-soft`, not `ink-muted`.** §3.6's one place where a family changes a colour
 *    choice: the serif's thin stems make a paragraph read lighter, so reading prose takes the
 *    8.89:1 soft tier rather than the muted one a sans body would take.
 *  - **`status` is its own `aria-live="polite"` region.** A run going from *running* to *paused*
 *    has to reach a screen reader without re-announcing the page title beside it.
 *  - **`meta` is a `MetaLine`, so there is nowhere to put a `·`** (§4.5). A fact line that is
 *    read once rather than compared down a column wants `MetaSentence` instead, and that belongs
 *    in the body, not here.
 *
 * The header draws no bottom margin. Spacing between the header and the content belongs to the
 * template that slots it — `DocumentPage`, `InstrumentPage`, `SplitPage` — which is the one
 * place that knows which of the two density regimes the screen declared (§5.3).
 */
/**
 * DESIGN-SYSTEM §3.7's eyebrow-over-title gap: 12px, sans over sans, identical with and without
 * `text-box` support. It is a spacing-scale step (`--spacing` × 3) and not a pixel literal, so it
 * moves with the scale if the scale ever moves.
 */
const EYEBROW_TITLE_GAP = "mt-3";

export interface PageHeaderProps {
  /** The record's name. A string: the `<h1>` is a name, not a sentence. */
  title: string;
  crumbs?: readonly Crumb[];
  /** A sentence about this screen, serif, at `--measure-lede`. */
  lede?: ReactNode;
  /** Sentence case, above the title. What kind of record this is. */
  eyebrow?: string;
  /** The hairline-separated fact line. */
  meta?: readonly MetaFact[];
  actions?: ReactNode;
  /** The live `Chip`, or a run-status word. Announced politely on change. */
  status?: ReactNode;
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { title, crumbs, lede, eyebrow, meta, actions, status },
  ref,
) {
  return (
    <header ref={ref}>
      {crumbs === undefined || crumbs.length === 0 ? null : (
        <div className="mb-3">
          <Breadcrumb items={crumbs} />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow === undefined ? null : (
            <Text as="div" size="eyebrow" tone="muted">
              {eyebrow}
            </Text>
          )}

          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1",
              eyebrow === undefined ? undefined : EYEBROW_TITLE_GAP,
            )}
          >
            <Heading level={1} className="min-w-0">
              {title}
            </Heading>
            {status === undefined ? null : (
              <div aria-live="polite" className="shrink-0">
                {status}
              </div>
            )}
          </div>

          {meta === undefined || meta.length === 0 ? null : (
            <div className="mt-2">
              <MetaLine facts={meta} size="ui" />
            </div>
          )}

          {lede === undefined ? null : (
            <div className={cn("mt-3", textStyles({ size: "lede", tone: "soft" }))}>
              <Measure as="div" width="lede">
                {lede}
              </Measure>
            </div>
          )}
        </div>

        {actions === undefined ? null : (
          <Inline gap={2} align="center" wrap className="shrink-0">
            {actions}
          </Inline>
        )}
      </div>
    </header>
  );
});
