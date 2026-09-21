import { forwardRef, type ReactNode } from "react";

import { Measure, Text } from "../../atoms/index.js";

/**
 * DiagramSays — the explaining sentence under a stage heading (DESIGN-SYSTEM §3.1, §4.7).
 *
 * Serif, at the reading measure, in `ink-soft`: here the **product is speaking**, as against the
 * mono the machine speaks in and the sans a name is set in. That is the whole of the rule, and it
 * is the reason this is a component rather than a `<p>` — `VisitDiagram`, `EvidenceDiagram` and
 * `PipelineDiagram` each declared a private `Says` with exactly this body when this folder was
 * built in parallel, and three spellings of one sentence style is how the seam between prose and
 * machine output goes soft one commit at a time.
 *
 * It is a `<p>` at the reading measure and nothing else — there is no `className`, because a
 * sentence whose measure or ink a call site can override is not one style. A stage that wants two
 * paragraphs uses two of these; a stage that wants a mono string mid-sentence puts a `Mono` inside
 * one, which is §4.3's inline seam doing its job and is why `children` is a node rather than a
 * string.
 */
export interface DiagramSaysProps {
  children: ReactNode;
}

export const DiagramSays = forwardRef<HTMLElement, DiagramSaysProps>(function DiagramSays(
  { children },
  ref,
) {
  return (
    <Measure ref={ref} as="p" width="read">
      <Text as="span" size="read-sm" tone="soft">
        {children}
      </Text>
    </Measure>
  );
});
