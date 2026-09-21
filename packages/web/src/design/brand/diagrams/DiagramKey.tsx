import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../cn.js";
import { Text } from "../../atoms/index.js";

/**
 * DiagramKey — the legend that keys a figure's shapes to its words (DESIGN-SYSTEM §1.3 rule 4,
 * §4.2).
 *
 * **Shape first, word second, colour last.** Every figure in this folder draws in the mark's
 * grammar — a filled circle is somebody who was there, a ring is somebody who was not, the dashed
 * 2/7 stroke is a thing that has not happened yet (§8.6) — and every one of those readings is
 * written out beside its shape here. That is what makes the figures legible with the colour
 * removed: strip the hue and the shape and the word both survive, which is the redundancy §4.2
 * asks of any state anywhere.
 *
 * It is one component because it was five. `VarianceDiagram` and `CoverageDiagram` each wrote a
 * dot-and-ring strip on a hairline, `AbsenceDiagram` wrote a single inline swatch, and
 * `EvidenceDiagram` and `PipelineDiagram` each wrote a flex `<ul>` of glyphs beside verdict tags —
 * the same list, five times, drifting in its gaps and its rule. A legend whose spacing differs
 * between two figures on one page is the tell that the figures were not built together.
 *
 * **The label is a node, not a string**, because half the keys in this folder are keyed to a real
 * `VerdictTag` or a real `Badge` rather than to a phrase. A plain string is set in `t-meta`,
 * `ink-muted`, which is what a phrase wants; anything else is rendered as it was passed.
 *
 * `aria-hidden` is deliberately **not** applied. A key is the sentence that makes the picture
 * readable, so it is read — the glyphs inside it carry no `label`, so nothing is announced twice.
 */

/**
 * The gaps. `row` is the strip under a picture; `stack` is a column, for a rail or a figure whose
 * key is longer than its width. Both wrap, and both are on the 4px base scale.
 */
const key = cva("m-0 flex list-none p-0", {
  variants: {
    layout: {
      row: "flex-wrap items-center gap-x-6 gap-y-2",
      stack: "flex-col items-start gap-2",
    },
    /** A hairline above it — the key belongs to the picture, and the rule says where it ends. */
    ruled: {
      true: "border-t border-rule pt-3",
      false: "",
    },
  },
  defaultVariants: { layout: "row", ruled: false },
});

/** One reading: the shape, and what it means in words. */
export interface DiagramKeyItem {
  /** A stable key for the row. The reading's own name — `"present"`, `"confirmed"`. */
  id: string;
  /**
   * The shape, drawn in the mark's grammar. Pass the real primitive — a `Dot`, a `Ring`, a
   * `Capsule` — with **no `label`**: the words beside it are the label.
   */
  glyph: ReactNode;
  /** What it means. A string is set as quiet meta; a node is rendered as it was passed. */
  label: ReactNode;
}

export interface DiagramKeyProps {
  items: readonly DiagramKeyItem[];
  layout?: "row" | "stack";
  ruled?: boolean;
  className?: string;
}

export const DiagramKey = forwardRef<HTMLUListElement, DiagramKeyProps>(function DiagramKey(
  { items, layout = "row", ruled = false, className },
  ref,
) {
  return (
    <ul ref={ref} className={cn(key({ layout, ruled }), className)}>
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2">
          {item.glyph}
          {typeof item.label === "string" ? (
            <Text size="meta" tone="muted">
              {item.label}
            </Text>
          ) : (
            item.label
          )}
        </li>
      ))}
    </ul>
  );
});
