import { forwardRef, type ReactNode } from "react";
import { cn } from "../cn.js";
import { textStyles, type TextSize, type TextTone } from "./Text.js";

/**
 * Heading — owns the document's heading order, so a screen never hand-rolls an `<h1>`.
 *
 * `level` is the semantics and `size` is the appearance, and they are separate on purpose: a
 * section whose label is set into a rule is an `<h2>` at `t-eyebrow`, not a 24px title, and an
 * outline reader still walks 1 → 2 → 3.
 *
 * The defaults are the ones the inventory names: level 1 is the record's name (`t-title`, sans
 * 24/30, §3.3), level 2 is the label set into a section rule (`t-eyebrow`, sentence case — caps
 * are confined to `t-label`'s four data roles), level 3 is a record's name inside a block
 * (`t-name`).
 */

/**
 * The steps a heading may take. This is `TextSize` plus the two sans display steps, which exist
 * only here: `title` is the `<h1>` of every record screen, and `masthead` is the landing hero,
 * once per site (§3.3, and §3.1's first named exception).
 */
export type HeadingSize = TextSize | "title" | "masthead";

/** Appearance follows semantics unless a screen says otherwise. Values, not class strings. */
const DEFAULT_SIZE: Record<1 | 2 | 3, HeadingSize> = {
  1: "title",
  2: "eyebrow",
  3: "name",
};

export interface HeadingProps {
  level: 1 | 2 | 3;
  size?: HeadingSize;
  tone?: TextTone;
  id?: string;
  className?: string;
  children: ReactNode;
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level, size, tone = "ink", id, className, children },
  ref,
) {
  const Component = `h${level}` as const;
  return (
    <Component
      ref={ref}
      id={id}
      className={cn(textStyles({ size: size ?? DEFAULT_SIZE[level], tone }), className)}
    >
      {children}
    </Component>
  );
});
