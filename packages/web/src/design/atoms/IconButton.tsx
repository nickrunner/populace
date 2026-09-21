import { cva } from "class-variance-authority";
import { cloneElement, forwardRef } from "react";
import type { MouseEvent, ReactElement } from "react";

import { cn } from "../cn.js";
import { Button, type ButtonProps } from "./Button.js";
import { Icon, type IconName } from "./Icon.js";
import { Tooltip } from "./Tooltip.js";

/**
 * IconButton — ATOMIC-INVENTORY §1 atom 7. Replaces the `Stepper`'s −/+ and every copy
 * affordance in the product.
 *
 * `label` is not optional, and neither is the tooltip: DESIGN-SYSTEM §6 allows an affordance
 * glyph to appear without visible text *only* inside this component, and only because this
 * component always carries both an `aria-label` and a `Tooltip`. One string feeds both, so they
 * cannot drift apart.
 *
 * Variants are the three shells that make sense without a word beside them. There is no
 * `primary` icon button: a filled square with a glyph in it and no label is a guess, and the one
 * act important enough to fill is important enough to name.
 *
 * The tap-target floor is where this atom earns its keep — the `Stepper`'s − and + are ~20×24
 * today and fail §6 outright. The square sizes below are 24 / 32 / 40, and `Button`'s coarse
 * pointer `::after` box takes all three to 44 without touching layout.
 *
 * **`disabled` is drawn as `aria-disabled`, and that is not a stylistic preference.** A natively
 * disabled button takes no pointer events, so its `Tooltip` can never open, and it leaves the tab
 * order, so a keyboard reader never meets it either — which means an icon button at a bound has
 * neither of the two things §6 requires of one, and the only thing left on screen is a glyph with
 * no name. `Stepper`'s − at 1 is the live case: the control the reader most needs explained is
 * exactly the one that stops explaining itself. So the button stays focusable and hoverable, says
 * `aria-disabled` to assistive technology, and swallows the click. `Button`'s own doc comment
 * prescribes this pairing ("a disabled button that needs explaining takes `aria-disabled` and a
 * `Tooltip` instead"); an `IconButton` always needs explaining, so it is unconditional here.
 */

/** Square, not padded: the glyph is centred by the flex shell `Button` already sets. */
const iconButton = cva("px-0", {
  variants: {
    size: {
      sm: "size-6",
      md: "size-8",
      lg: "size-10",
    },
  },
  defaultVariants: { size: "md" },
});

/**
 * The glyph step per square. Not a CVA: this resolves to `Icon`'s numeric `size` prop, not to a
 * class string, so there is nothing here for `cn()` to merge.
 */
const GLYPH_STEP = { sm: 12, md: 16, lg: 20 } as const;

/**
 * The inert shell. `Button`'s disabled ink is written against the `disabled:` variant, which an
 * `aria-disabled` button never matches — so the three shells that can be inert restate it here.
 * `aria-disabled:hover:*` outranks `hover:*` by specificity (an attribute selector plus a
 * pseudo-class), so the hover language is off whatever order `cn()` emits the classes in, and
 * every value is a token: disabled is carried by colour, never by opacity.
 */
const inert = cva("", {
  variants: {
    variant: {
      quiet: [
        "aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted",
      ].join(" "),
      secondary: [
        "aria-disabled:border-rule aria-disabled:bg-transparent aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent",
      ].join(" "),
      danger: [
        "aria-disabled:border-rule aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent",
      ].join(" "),
    },
  },
  defaultVariants: { variant: "quiet" },
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "variant"> {
  icon: IconName;
  /** Both the `aria-label` and the tooltip text. Never a fact available nowhere else. */
  label: string;
  variant?: "quiet" | "secondary" | "danger";
  /**
   * At a bound, not gone. Restated from `ButtonProps` because it means something else here: the
   * button keeps its tab stop, its `aria-label` and its `Tooltip`, wears `aria-disabled`, and
   * swallows the press.
   */
  disabled?: boolean;
  /**
   * The element to render as, when `asChild` is set — a `<Link>`, normally. The inventory's
   * signature omits `children` outright, which leaves the inherited `asChild` with nothing to
   * stand in for; this narrower, optional re-addition is what makes that prop mean something.
   * The glyph is injected as the slotted element's content, so the caller never spells it twice.
   */
  children?: ReactElement;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = "quiet",
    size = "md",
    asChild = false,
    className,
    children,
    disabled,
    onClick,
    ...rest
  },
  ref,
) {
  const glyph = <Icon name={icon} size={GLYPH_STEP[size]} />;
  const inactive = disabled === true;

  return (
    <Tooltip content={label}>
      <Button
        ref={ref}
        variant={variant}
        size={size}
        asChild={asChild}
        aria-label={label}
        aria-disabled={inactive ? true : undefined}
        // The press is swallowed here rather than by the platform, so the target keeps its
        // pointer events and the tooltip still opens. `preventDefault` also stops a slotted
        // `<Link>` navigating, since `Slot` skips the child's handler on a prevented event.
        onClick={
          inactive
            ? (event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
              }
            : onClick
        }
        className={cn(iconButton({ size }), inert({ variant }), className)}
        {...rest}
      >
        {asChild && children ? cloneElement(children, undefined, glyph) : glyph}
      </Button>
    </Tooltip>
  );
});
