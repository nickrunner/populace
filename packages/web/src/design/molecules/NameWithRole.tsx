import { forwardRef } from "react";

import { Heading, Inline, Link, Separator, Text } from "../atoms/index.js";

/**
 * NameWithRole — a name and what it is here (ATOMIC-INVENTORY §2, 19).
 *
 * Replaces three spellings of `name · role`. The middle dot is gone: facts are separated by a
 * 12px vertical hairline (§4.5), and the dot survives in this product only inside a `t-code-sm`
 * string the target app itself produced.
 *
 * The name is `t-name`, §3.3's step for "a record's name inside a row, cell or card", and it is
 * the **stored name** — never an id and never a slug (§7.4). The role is the quiet half: `t-meta`
 * in `ink-muted`, which is a secondary chrome fact and reads as one.
 *
 * `to` is optional because the same pairing appears where the name is already the heading of the
 * thing you are looking at, and a link to the page you are on is noise. When it is present, the
 * step arrives through `Link`'s `className` — `Link`'s `size` union excludes the name step by
 * design, and `cn()` resolves the type steps as one class group so the last one wins.
 *
 * Baseline alignment, which is `Inline`'s default and the correct one here: two sans steps of
 * different sizes sitting on one line (§3.6).
 *
 * **`level` makes the name a real heading**, which is what a ledger row's name is: every other
 * ledger in the product gives its row an `<h3>`, and a page of rows whose names are `<span>`s is
 * a page with no outline for a screen reader to move through (§6, "Heading order"). The step
 * does not change with the level — `t-name` either way — because the level is the semantics and
 * the type step is fixed. A linked name puts the `<a>` inside the heading, where `Link` inherits
 * the step it sits in rather than restating it.
 */

export interface NameWithRoleProps {
  /** The stored name (§7.4). */
  name: string;
  /** What they are in this context — a word, not an id. */
  role: string;
  /** Absent where the name is already the heading of what you are looking at. */
  to?: string;
  /**
   * Draws the name as a heading at this level. A row inside a `Section` is 3; a row in a block
   * sitting directly under a `PageHeader` is 2. Omitted where the pairing is not a record's own
   * name — a starter in a picker, a name repeated beside the page it titles.
   */
  level?: 2 | 3;
}

export const NameWithRole = forwardRef<HTMLDivElement, NameWithRoleProps>(function NameWithRole(
  { name, role, to, level },
  ref,
) {
  // Linked or not, the step is `t-name` and it is spelled exactly once: on the heading when
  // there is one, on the `Text` or the `Link` when there is not.
  const named = to === undefined ? name : <Link to={to}>{name}</Link>;

  return (
    <Inline ref={ref} gap={2} align="baseline">
      {level === undefined ? (
        to === undefined ? (
          <Text size="name">{name}</Text>
        ) : (
          <Link to={to} className="t-name">
            {name}
          </Link>
        )
      ) : (
        <Heading level={level} size="name" className="min-w-0">
          {named}
        </Heading>
      )}
      <Separator orientation="vertical" />
      <Text size="meta" tone="muted" truncate>
        {role}
      </Text>
    </Inline>
  );
});
