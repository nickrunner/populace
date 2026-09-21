import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { Stack, Text } from "../atoms/index.js";
import { MetaLine, NameWithRole, PersonLink } from "../molecules/index.js";
import { surfaceBase } from "../variants.js";

/**
 * PersonQuoteCard — somebody's own words, with their name on them (DESIGN-SYSTEM §3.2, §7.4).
 *
 * The product reports in the serif and people speak in the serif's italic: `t-voice` is the only
 * italic in the system, and it exists for exactly this — a verbatim line a person wrote, set
 * apart from the sentence the product writes about it. That is the whole card. A `<blockquote>`
 * holding the words, a `<figcaption>` holding who said them and when, and a card's elevation
 * around the pair so a quote inside a findings page cannot be mistaken for the page's own voice
 * (§4.7).
 *
 * **The words are never shrunk.** §1.3 rule 6: no serif below 13px, and if a container cannot
 * afford the sentence the container is wrong. So `size` changes the frame — padding, and how
 * loudly the attribution is set — and never the step the words are set in. `sm` is the quote
 * beside a finding; `md` is the quote that *is* the block, on the page for the people who
 * walked away.
 *
 * **The attribution is a person, not a persona** (§7.4). Where the reader can go to them the
 * name is a `PersonLink`, avatar and cohort included; where they cannot it is a `NameWithRole`
 * with the cohort as the role. The visit number is the third fact, hairline-separated like every
 * other fact line in the product (§4.5) — and it is a *visit*, which is the only word this
 * product has for one session one person had.
 */

const quoteCard = cva("", {
  variants: {
    size: {
      sm: "p-3.5",
      md: "p-4",
    },
  },
  defaultVariants: { size: "md" },
});

export interface PersonQuoteCardProps {
  /** The stored name of whoever said it. */
  name: string;
  /** Their words, verbatim. Never paraphrased, never truncated by this component. */
  words: string;
  /** The cohort they belong to. */
  cohort: string;
  /** Which of their visits this came from. */
  visit: number;
  size?: "sm" | "md";
  /** Their page, where the reader is allowed to go to it. */
  to?: string;
}

export const PersonQuoteCard = forwardRef<HTMLElement, PersonQuoteCardProps>(
  function PersonQuoteCard({ name, words, cohort, visit, size = "md", to }, ref) {
    return (
      <figure
        ref={ref}
        className={cn(
          surfaceBase({ level: "card" }),
          quoteCard({ size }),
          "flex w-full min-w-0 flex-col gap-3",
        )}
      >
        <blockquote>
          {/* Curly quotes, because these are somebody's actual words and the punctuation is part
              of saying so. The italic of `t-voice` carries the rest. */}
          <Text size="voice" tone="ink" as="p">
            {"\u201C"}
            {words}
            {"\u201D"}
          </Text>
        </blockquote>

        {/* `figcaption` has to be the figure's own first or last child, so the gap above is the
            figure's flex column rather than a `Stack` wrapper that would invalidate it. */}
        <figcaption>
          <Stack gap={1} align="start">
            {to === undefined ? (
              <NameWithRole name={name} role={cohort} />
            ) : (
              <PersonLink name={name} to={to} cohort={cohort} size={size} />
            )}
            <MetaLine facts={[{ key: "visit", node: `visit ${visit}` }]} />
          </Stack>
        </figcaption>
      </figure>
    );
  },
);
