import { Fragment, forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { Inline, Separator } from "../atoms/index.js";
import { textStyles } from "../atoms/Text.js";

/**
 * MetaLine — facts separated by a hairline, never by a middle dot — ATOMIC-INVENTORY §2,
 * molecule 25, DESIGN-SYSTEM §4.5.
 *
 * ```
 * ephemeral │ Early adopters (12 people, 2 cohorts) → Checkout │ execution 3 │ 14 Mar 09:41
 * ```
 *
 * This is one of the six signature moves doing its work in the smallest possible component. A
 * dot-joined meta string is the generic default that every dashboard ships; a 12px vertical
 * hairline between facts is what a scale looks like, and it costs exactly the same markup. The
 * app has the dot in two incompatible spellings across ~30 sites today, which is why the
 * separator is not a prop, not a default and not overridable: **the API has nowhere to put a
 * dot.** Hand the component facts and it draws the rule; there is no third thing to hand it.
 *
 * (The one surviving `·` in the product is inside a `t-code-sm` machine string, where the target
 * app produced it. That arrives inside a fact's own node and is none of this component's
 * business.)
 *
 * The line carries its type step and its muted ink on the container rather than on each fact, so
 * a bare string, a `Mono` tool name and a `Chip` can sit on the same line and only the plain
 * strings take the default. `size="ui"` is the 13px chrome register for a header band; the
 * default `"meta"` is the 12px one for a row.
 *
 * Facts wrap rather than overflow, and the hairline goes with them. An empty fact — a count that
 * has not arrived, an optional cohort — is dropped along with the rule that would have preceded
 * it, so a line never opens or closes on a stray tick.
 *
 * For a line that is **read once rather than compared down a column** — a detail pane, a lede, an
 * empty state, an `aria-label` — this is the wrong component and `MetaSentence` is the right one.
 */
export interface MetaFact {
  /** Stable across renders; this is the React key, so it is what a fact IS, not its position. */
  key: string;
  node: ReactNode;
}

export interface MetaLineProps {
  facts: readonly MetaFact[];
  /** `meta` is the 12px row register, `ui` the 13px header-band one. Default `"meta"`. */
  size?: "meta" | "ui";
}

/** Nothing renders for a fact with no content, and neither does the rule beside it. */
function hasContent(fact: MetaFact): boolean {
  return fact.node !== null && fact.node !== undefined && fact.node !== false && fact.node !== "";
}

export const MetaLine = forwardRef<HTMLDivElement, MetaLineProps>(function MetaLine(
  { facts, size = "meta" },
  ref,
) {
  const shown = facts.filter(hasContent);
  if (shown.length === 0) return null;

  return (
    <Inline
      ref={ref}
      gap={2}
      align="baseline"
      wrap
      className={cn(textStyles({ size, tone: "muted" }))}
    >
      {shown.map((fact, index) => (
        <Fragment key={fact.key}>
          {index === 0 ? null : <Separator orientation="vertical" />}
          {fact.node}
        </Fragment>
      ))}
    </Inline>
  );
});
