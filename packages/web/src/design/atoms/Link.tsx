import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, useCallback } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Icon } from "./Icon.js";
import type { TextSize } from "./Text.js";
import { VisuallyHidden } from "./VisuallyHidden.js";

/**
 * Link — ATOMIC-INVENTORY §1 atom 8. 34 sites across four different spellings of
 * `text-accent hover:underline`, none of them focusable-visible.
 *
 * Two things make this atom worth having beyond the class string it replaces:
 *
 *  1. **It inherits the family it sits in.** `size` is optional and *unset by default*, so a link
 *     inside a serif paragraph is serif and the same component inside the chrome is sans. Passing
 *     `size` is the exception, not the rule.
 *  2. **The dark deviation.** `--c-link` is lime in dark, and a paragraph threaded with
 *     full-strength lime glyphs is unreadable in a way that a single lime underline is not (§2.3,
 *     the `--c-link` row). So in dark the glyphs stay `ink` and the underline alone carries the
 *     colour. That flip is a `dark:` utility, never a branch in TypeScript.
 *
 * The underline is always present, in both tones, because colour alone may not carry a state or
 * an affordance (§1.3 rule 4). Hover thickens it rather than adding it.
 */

const link = cva(
  [
    "inline rounded-sm",
    "underline decoration-1 underline-offset-2 hover:decoration-2",
    pressTransition,
    focusRing,
  ].join(" "),
  {
    variants: {
      /** Unset means "take the step of whatever this sits inside", which is the common case. */
      size: {
        read: "t-read",
        "read-sm": "t-read-sm",
        ui: "t-ui",
        meta: "t-meta",
      },
      tone: {
        primary: "text-link decoration-link dark:text-ink",
        quiet: "text-ink-soft decoration-rule-strong hover:text-ink hover:decoration-link",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

export type LinkStyleVariants = VariantProps<typeof link>;

type LinkElement = HTMLAnchorElement | HTMLButtonElement;

export interface LinkProps {
  /** An in-app route. Takes precedence over `href` if both are somehow given. */
  to?: string;
  /**
   * An external destination. Carries the `external` glyph, `target="_blank"` and a note for
   * screen readers — **unless it starts with `#`**, which is a fragment in this same document and
   * gets a plain anchor with none of the three.
   */
  href?: string;
  size?: Extract<TextSize, "read" | "read-sm" | "ui" | "meta">;
  tone?: "primary" | "quiet";
  asChild?: boolean;
  onClick?: (e: MouseEvent) => void;
  className?: string;
  children: ReactNode;
}

export const Link = forwardRef<LinkElement, LinkProps>(function Link(
  { to, href, size, tone = "primary", asChild = false, onClick, className, children },
  ref,
) {
  // The three branches land on two different element types, so the ref is adapted rather than
  // cast: `Ref<HTMLAnchorElement | HTMLButtonElement>` is not assignable to `Ref<HTMLAnchorElement>`
  // through the object arm, and a cast to get there would be a lie about what was mounted.
  const setRef = useCallback(
    (node: LinkElement | null) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  const classes = cn(link({ size, tone }), className);

  if (asChild) {
    return (
      <Slot ref={setRef} className={classes} onClick={onClick}>
        {children}
      </Slot>
    );
  }

  if (to !== undefined) {
    return (
      <RouterLink ref={setRef} to={to} className={classes} onClick={onClick}>
        {children}
      </RouterLink>
    );
  }

  if (href !== undefined) {
    // A `#`-leading href is a place ON THIS PAGE, not a destination away from it. Sending it to a
    // new tab opens a second copy of the document the reader is already in, and the glyph and the
    // "(opens in a new tab)" note both announce a departure that is not happening. The test is
    // the leading `#` and nothing cleverer: `#main` and `#variance` are fragments, `https://…#x`
    // is an external page that happens to carry one, and the string tells the two apart.
    if (href.startsWith("#")) {
      return (
        <a ref={setRef} href={href} className={classes} onClick={onClick}>
          {children}
        </a>
      );
    }

    return (
      <a
        ref={setRef}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={classes}
        onClick={onClick}
      >
        {children}
        <Icon name="external" size={12} className="ml-0.5 align-baseline" />
        <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
      </a>
    );
  }

  // Neither a route nor a destination: this navigates nowhere, so it is a button that happens to
  // be set as a link — "Show all 312 lines". Making it an anchor would lie to the keyboard.
  return (
    <button ref={setRef} type="button" className={classes} onClick={onClick}>
      {children}
    </button>
  );
});
