import { forwardRef } from "react";

import { Mono, Text } from "../atoms/index.js";

/**
 * ToolName — the naming half of the evidence seam (DESIGN-SYSTEM §4.3).
 *
 * A tool is something the target app is *named by*, so it is set in IBM Plex Mono in `evidence`
 * and never in the chrome's sans. That single choice does a surprising amount of work: in a
 * transcript row a tool call's title is mono and blue while every other kind of step's title is
 * sans, so **the family alone tells you which steps touched the target**, with no colour read at
 * all — which is the seam surviving greyscale.
 *
 * **A missing tool is a word, never a strikethrough** (§4.2). When the product copy promises a
 * tool the target does not expose, the name still prints in full — it is evidence, and evidence
 * is not decorated away — and `— not exposed` follows it in `ink-muted`. Strikethrough plus
 * opacity is exactly the colour-and-texture-alone failure the accessibility contract forbids,
 * and it also makes the one string a reader most needs to copy the hardest one to read.
 *
 * The suffix is set in the sans, not in the mono, because §4.7 is strict about who is speaking:
 * the machine said `delete_task`, and *we* are the ones saying it is not exposed. The families
 * keep the two apart in the same line.
 *
 * There is no flex box and no layout class here on purpose. A tool name turns up inside a serif
 * sentence, inside a 32px transcript row and inside a table cell, so it has to be ordinary inline
 * content that wraps with the line around it — `Inline` is the atom for this shape, but `Inline`
 * is a block-level `<div>` and cannot live inside a paragraph.
 */

export interface ToolNameProps {
  name: string;
  /** The target does not expose this tool. Renders the name plus `— not exposed`. */
  missing?: boolean;
}

export const ToolName = forwardRef<HTMLSpanElement, ToolNameProps>(function ToolName(
  { name, missing = false },
  ref,
) {
  return (
    <span ref={ref}>
      <Mono size="code">{name}</Mono>
      {missing ? (
        <>
          {" "}
          <Text size="meta" tone="muted">
            — not exposed
          </Text>
        </>
      ) : null}
    </span>
  );
});
