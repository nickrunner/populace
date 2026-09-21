import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

import { cn } from "../cn.js";
import type { ControlSize } from "../tokens.js";
import { focusRing, pressTransition } from "../variants.js";
import { Spinner } from "./Spinner.js";

/**
 * Button — ATOMIC-INVENTORY §1 atom 6. 45 sites, none of which has a focus style today.
 *
 * Five variants, and the reason there are five rather than a `tone` union is that each one is a
 * different *shell*, not a different hue:
 *
 *  - `primary`   the filled one. `bg-primary` / `text-on-primary`, which is forest + paper in
 *                light and lime + ink in dark (DESIGN-SYSTEM §5.4 item 3, and §10 risk 7: the
 *                hue swap between themes is the only arrangement that works, because forest on
 *                the dark ground is 1.55:1 and lime on paper is 1.08:1). Never `text-white`.
 *  - `secondary` the default, and the control shell of `variants.ts` at button padding:
 *                `rule-strong` boundary, because WCAG 1.4.11 asks 3:1 of anything bounding an
 *                interactive element and the decorative `rule` is 1.37–2.62:1.
 *  - `quiet`     no shell until it is hovered. `ink-soft` is §2.2's "quiet button label".
 *  - `danger`    critical ink on a critical hairline, and **never a filled red button**: a
 *                destructive act goes through a `Dialog`, so the button itself only needs to
 *                name the risk, not shout it.
 *  - `link`      a button that is semantically a button and typographically a link — "Show all
 *                312 lines", which must not be an anchor because it navigates nowhere.
 *
 * Hover moves the filled variant's ground by mixing `primary` *towards `ink`*, which darkens it
 * in light and lightens it in dark, because `ink` is paper on the dark ground. That keeps the
 * rule "every variant is written against a token" — there is no `primary-hover` token and an
 * alpha over a hard ground is banned — while still giving both themes a hover in the direction
 * that reads as more energy.
 *
 * Disabled is carried by colour tokens, never by opacity, so a disabled control stays legible on
 * every ground. A disabled button that needs explaining takes `aria-disabled` and a `Tooltip`
 * instead, which is why `aria-disabled` gets the same cursor as `disabled`.
 *
 * **`atBound` is that second state, and it is a prop rather than a convention** (§6, "A control
 * at a bound is inert, not gone"). A natively `disabled` button takes no pointer events — so the
 * `Tooltip` that would say *why* can never open — and leaves the tab order, so a keyboard reader
 * never meets the control or its explanation at all. `atBound` keeps the tab stop and the
 * pointer events, wears `aria-disabled`, restates the inert ink against the `aria-disabled:`
 * variant (which the `disabled:` classes above never match), and swallows the press here rather
 * than at the platform. It exists on `Button` and not only on `IconButton` because the two
 * screens that gate *spending real money* behind a list of blockers gate a text button.
 */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "link";

/**
 * 24×24px is the floor for every control (§6), and on a coarse pointer the target grows to 44px
 * through a `::after` box that does not touch layout. The `link` variant is deliberately excluded
 * by the compound variant below: an inline link inside prose is exempt, and a 44px box around one
 * would swallow the words either side of it.
 */
const COARSE_HIT_AREA = [
  "pointer-coarse:after:absolute",
  "pointer-coarse:after:top-1/2",
  "pointer-coarse:after:left-1/2",
  "pointer-coarse:after:h-11",
  "pointer-coarse:after:w-full",
  "pointer-coarse:after:min-w-11",
  "pointer-coarse:after:-translate-x-1/2",
  "pointer-coarse:after:-translate-y-1/2",
  "pointer-coarse:after:content-['']",
].join(" ");

/**
 * `size` is declared before `variant` so that the `link` variant's `h-auto px-0` is emitted after
 * the size's `h-8 px-3` and wins in `cn()`. CVA joins in key order; `cn()` resolves the conflict.
 */
export const button = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 select-none",
    "t-ui whitespace-nowrap",
    // §5.2: 6px is the controls radius. `box-shadow` inherits it, so the focus ring follows.
    "rounded-sm border border-transparent",
    pressTransition,
    focusRing,
    "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed",
  ].join(" "),
  {
    variants: {
      /** sm 24px · md 32px · lg 40px — the three control heights the inventory names. */
      size: {
        sm: "h-6 px-2",
        md: "h-8 px-3",
        lg: "h-10 px-4",
      },
      variant: {
        primary: [
          "bg-primary text-on-primary",
          "hover:[background-color:color-mix(in_oklab,var(--color-primary)_88%,var(--color-ink))]",
          "active:[background-color:color-mix(in_oklab,var(--color-primary)_78%,var(--color-ink))]",
          "disabled:border-rule disabled:bg-sunk disabled:text-ink-muted",
        ].join(" "),
        secondary: [
          "border-rule-strong bg-surface text-ink dark:bg-sunk",
          "hover:bg-hover",
          "disabled:border-rule disabled:bg-transparent disabled:text-ink-muted",
        ].join(" "),
        quiet: [
          "bg-transparent text-ink-soft",
          "hover:bg-hover hover:text-ink",
          "disabled:bg-transparent disabled:text-ink-muted",
        ].join(" "),
        danger: [
          "border-critical bg-transparent text-critical",
          "hover:bg-hover",
          "disabled:border-rule disabled:text-ink-muted",
        ].join(" "),
        link: [
          "h-auto bg-transparent px-0",
          // The glyph stays ink in dark and the underline alone carries the lime (§2.3's
          // `--c-link` row), so a paragraph is not threaded with full-strength lime.
          "text-link dark:text-ink",
          "underline decoration-link decoration-1 underline-offset-2 hover:decoration-2",
          "disabled:text-ink-muted disabled:no-underline",
        ].join(" "),
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    compoundVariants: [
      { variant: ["primary", "secondary", "quiet", "danger"], class: COARSE_HIT_AREA },
    ],
    defaultVariants: { size: "md", variant: "secondary", fullWidth: false },
  },
);

export type ButtonStyleVariants = VariantProps<typeof button>;

/**
 * The inert shell for a control at a bound. `button`'s disabled ink is written against the
 * `disabled:` variant, which an `aria-disabled` button never matches, so every variant restates
 * it here. `aria-disabled:hover:*` outranks `hover:*` by specificity — an attribute selector plus
 * a pseudo-class — so the hover language is off whatever order `cn()` emits the classes in, and
 * every value is a token: inert is carried by colour, never by opacity.
 */
const inert = cva("", {
  variants: {
    variant: {
      primary: [
        "aria-disabled:border-rule aria-disabled:bg-sunk aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-sunk aria-disabled:active:bg-sunk",
      ].join(" "),
      secondary: [
        "aria-disabled:border-rule aria-disabled:bg-transparent aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent",
      ].join(" "),
      quiet: [
        "aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted",
      ].join(" "),
      danger: [
        "aria-disabled:border-rule aria-disabled:text-ink-muted",
        "aria-disabled:hover:bg-transparent",
      ].join(" "),
      link: "aria-disabled:text-ink-muted aria-disabled:no-underline",
    },
  },
  defaultVariants: { variant: "secondary" },
});

/**
 * The pending indicator sits on the filled ground, where `Spinner`'s lit dot — `primary` — would
 * be invisible. The overlay re-points that one custom property at `on-primary` for its own
 * subtree, which is a token-to-token redirection in CSS rather than a colour decision here; the
 * unlit rings keep `rule-strong`, which reads on both grounds.
 */
const pendingOverlay = cva("absolute inset-0 flex items-center justify-center", {
  variants: {
    variant: {
      primary: "[--color-primary:var(--color-on-primary)]",
      secondary: "",
      quiet: "",
      danger: "",
      link: "",
    },
  },
  defaultVariants: { variant: "secondary" },
});

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  /** sm 24px / md 32px / lg 40px. */
  size?: ControlSize;
  /** Render as the single child element instead — a `<Link>`, most often. */
  asChild?: boolean;
  /** Swaps the label for a `Spinner` without changing the button's width. */
  pending?: boolean;
  /**
   * The control is at a bound: it keeps its tab stop, its name and its `Tooltip`, wears
   * `aria-disabled`, and swallows the press. Use this — never the `disabled` attribute —
   * wherever the reason the control cannot be pressed is written somewhere the reader has to be
   * able to reach (§6). Pair it with a `Tooltip` and an `aria-describedby` naming the reason.
   */
  atBound?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    asChild = false,
    pending = false,
    atBound = false,
    fullWidth = false,
    className,
    children,
    disabled,
    type,
    onClick,
    ...rest
  },
  ref,
) {
  const classes = cn(
    button({ variant, size, fullWidth }),
    atBound && inert({ variant }),
    // Only reachable when the caller slots an element in and puts it in a pending state: the
    // label is not ours to wrap, so it is hidden by going transparent while the overlay, which
    // sets its own ink, keeps painting.
    asChild && pending && "text-transparent",
    className,
  );

  // Deliberately not a fragment: `Slot` walks its children with `React.Children.forEach`, which
  // does not descend into one, so a fragment would be cloned *as* the slotted element and the
  // class string would land on `React.Fragment`.
  const overlay = pending ? (
    <span aria-hidden="true" className={pendingOverlay({ variant })}>
      <Spinner label="Working" size={size === "lg" ? "md" : "sm"} />
    </span>
  ) : null;

  // The press is swallowed here rather than by the platform, so the target keeps its pointer
  // events and the tooltip explaining the bound can still open. `preventDefault` also stops a
  // slotted `<Link>` navigating, since `Slot` skips the child's handler on a prevented event.
  const press = atBound
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }
    : onClick;

  if (asChild) {
    return (
      <Slot
        ref={ref}
        className={classes}
        aria-busy={pending ? true : undefined}
        aria-disabled={atBound ? true : undefined}
        onClick={press}
        {...rest}
      >
        {overlay}
        <Slottable>{children}</Slottable>
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      // An unset `type` inside a form is `submit`, which has fired more accidental submissions
      // than it has saved keystrokes.
      type={type ?? "button"}
      // A pending button is not clickable; two presses of "Send them in" is two executions.
      // A button at a bound is NOT natively disabled: it keeps its tab stop and its tooltip.
      disabled={!atBound && (disabled === true || pending)}
      className={classes}
      aria-busy={pending ? true : undefined}
      aria-disabled={atBound ? true : undefined}
      onClick={press}
      {...rest}
    >
      {overlay}
      <span className={cn("inline-flex items-center gap-1.5", pending && "invisible")}>
        {children}
      </span>
    </button>
  );
});
