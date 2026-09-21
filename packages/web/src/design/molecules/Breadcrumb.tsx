import { forwardRef, Fragment } from "react";

import { Icon, Inline, Link, Text } from "../atoms/index.js";

/**
 * Breadcrumb — where you are, in the words of the levels above you (ATOMIC-INVENTORY §2, 15).
 *
 * Two things the current implementation is missing, and they are the reason this molecule exists
 * rather than a class string: **`aria-label` on the `<nav>`**, so a screen reader can tell this
 * landmark from the rail, and **`aria-current="page"` on the last crumb**, so it is announced as
 * where you are rather than as one more step.
 *
 * The last crumb is where you are and is **never a link** — it is the one item with no `to`, and
 * the component enforces that by construction: every item before the last renders a `Link`,
 * the last renders plain `Text` even if a caller passes a `to`.
 *
 * Set in `t-ui`, which §3.3 names as the chrome default for exactly this — "buttons, nav,
 * breadcrumbs, cells, chips". The ancestors are `quiet` links: `tone="primary"` would thread
 * three or four full-strength link colours across the top of every screen, which is the
 * paragraph problem of §2.3 at chrome scale. Quiet keeps the underline — colour alone may never
 * carry an affordance (§1.3 rule 4) — and hands the link ink back on hover.
 *
 * The chevron is an affordance glyph between two labels, so it is `aria-hidden`; the nesting is
 * carried by the markup, not by the glyph (§6, "Icons"). It is `1em`, so it tracks the step.
 */

export interface Crumb {
  label: string;
  /** Absent on the last crumb. Where you are is not a place you can go. */
  to?: string;
}

export interface BreadcrumbProps {
  items: readonly Crumb[];
}

export const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(function Breadcrumb(
  { items },
  ref,
) {
  return (
    <nav ref={ref} aria-label="Breadcrumb">
      <Inline gap={1} align="center" wrap>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${index}-${item.label}`}>
              {index > 0 ? (
                <Icon name="chevron-right" className="text-ink-muted" />
              ) : null}
              {last || item.to === undefined ? (
                // `aria-current` is not a `Text` prop, and it should not be: it is a statement
                // about this position in this trail, not about the type step. The span carries it.
                <span aria-current={last ? "page" : undefined}>
                  <Text size="ui" tone="muted">
                    {item.label}
                  </Text>
                </span>
              ) : (
                <Link to={item.to} size="ui" tone="quiet">
                  {item.label}
                </Link>
              )}
            </Fragment>
          );
        })}
      </Inline>
    </nav>
  );
});
