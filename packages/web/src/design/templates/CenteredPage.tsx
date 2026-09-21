import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import type { StateKind } from "../tokens.js";
import { pageStateSlot, type PageStateSlots } from "./DocumentPage.js";

/**
 * CenteredPage — ATOMIC-INVENTORY §4, template 6. One screen (`Projects`), plus `NotFound` and
 * the project and simulation shells' own error states.
 *
 * The railless one. It is what a screen uses when there is nothing beside the content and nothing
 * under it: a list of projects, a 404, a shell that could not load the record the rest of the
 * screens hang off. `--w-page-narrow` is 860px rather than 1100 because a page with no rail and
 * no table has no use for the extra 240px, and vertical air replaces the horizontal structure the
 * other templates get from their second column.
 *
 * **Centred frame, left-aligned content.** The column is centred in the viewport; nothing inside
 * it is. A centred sentence is a brochure and this product is a readout (DESIGN-SYSTEM §9.2), so
 * the template centres the *measure* and never the text.
 *
 * The header is optional here and required everywhere else, because two of this template's three
 * uses are a shell's error state, where the record whose name the `<h1>` would carry is precisely
 * what failed to load. A `StateBlock` handed to `gone` or `error` is then the whole page.
 */
export interface CenteredPageProps extends PageStateSlots {
  /** A `PageHeader`, when there is a record to name. Optional: a failed shell has none. */
  header?: ReactNode;
  /** When set, the matching slot renders INSTEAD of `children`. */
  state?: StateKind;
  children: ReactNode;
}

export const CenteredPage = forwardRef<HTMLDivElement, CenteredPageProps>(function CenteredPage(
  { header, state, loading, error, empty, gone, children },
  ref,
) {
  const body =
    state === undefined ? children : pageStateSlot(state, { loading, error, empty, gone });

  return (
    <div
      ref={ref}
      className={cn(
        "mx-auto w-full max-w-[var(--w-page-narrow)] px-4 md:px-8",
        // Vertically generous: this is the one template with room to spare.
        "py-16 md:py-24",
      )}
    >
      {header}
      <div className={header === undefined ? undefined : "mt-10"}>{body}</div>
    </div>
  );
});
