import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * Logo — the brand lockup, and the only thing in the product allowed to load brand artwork
 * (DESIGN-SYSTEM §8.1, §8.3; `Populace-Brand-Assets-v1/README.md`, "Logo rules").
 *
 * Before this component there were bare `<img src="/brand/…">` tags with hand-written light and
 * dark pairs, and every one of them was an opportunity to ship an illegal render: paper-coloured
 * lettering on a paper ground, the lime spark on a lime chip, a 96px horizontal lockup, a logo
 * squashed by the flex row it was dropped into. The kit's rules are not advisory — they are the
 * difference between the mark reading and the mark vanishing — so they are encoded here as
 * constraints rather than written down as a comment beside the artwork:
 *
 *  1. **The ground chooses the artwork, not the caller.** `on` names the ground the artwork sits
 *     on — `paper`, `surface`, `forest`, `signal` — and the table below turns that into the pair
 *     of files the cascade picks between. "Use inverse/white artwork only on dark backgrounds" is
 *     therefore not a rule anybody can break from a call site: there is no prop that spells it.
 *  2. **The minimum size is a type, not a note.** The kit's floor for the horizontal lockup is
 *     160px wide; `size` has no step below it. Ask for `xs` and you get **the standalone mark**,
 *     which is the kit's own instruction for what to do below the floor, rather than a 96px
 *     lockup whose lettering has closed up.
 *  3. **Clear space is real padding.** One circle diameter — 26 viewBox units — must surround the
 *     visible artwork, and the files carry 16 of it. The remaining 10 units are padding on the
 *     box, in the artwork's own units, so a `gap-0` row cannot crowd the mark. See `CLEAR` below.
 *  4. **It cannot be squashed.** The box is `box-content` at a fixed width, the image inside
 *     carries its intrinsic `width`/`height`, and the box is `shrink-0`. A flex parent has
 *     nothing to take.
 *
 * **The theme flip happens in CSS and only in CSS.** Both artworks are in the DOM and `dark:`
 * hides one of them — the same sanctioned `dark:` utility every other component in this system
 * uses for a structural light/dark difference (ATOMIC-INVENTORY §0.2). Nothing here reads the
 * theme: the attribute can change after paint, and a component that had asked which theme it was
 * in would have to re-render to find out it was wrong. Two of the four grounds do not flip at all
 * — a forest band is dark in both themes and a lime chip is light in both — so for those the
 * component renders **one** image and there is no second artwork to get wrong.
 *
 * **The artwork ships exactly as delivered.** No `currentColor`, no recoloured module, no
 * hand-edited path: §8.3 and the kit are both explicit that recolouring an individual module is
 * not ours to do. (§8.3 records that `logo-inverse` loses the lime spark; the shipped v1 file
 * keeps it — the dot at (44,44) is `#D7F56B` in both `-primary` and `-inverse`. Dark mode gets
 * its spark. Nothing was edited to make that true.)
 */

/** The ground the artwork is being placed on. Not a colour — a surface. */
export type BrandGround = "paper" | "surface" | "forest" | "signal";

/** The three lockups the app may use. `horizontal` is mark + wordmark, the full logo. */
export type LockupVariant = "horizontal" | "mark" | "wordmark";

/**
 * Five steps. What a step *means* depends on the lockup — 160px of horizontal logo and 16px of
 * mark are both `sm` — because the sizes that are legal for one are absurd for the other.
 *
 * `xl` is the **display** step, and it exists because the landing's hero wanted a 48–56px mark,
 * found the mark's table stopped at 32px, and reached around this component for a hand-written
 * pair of `<img>` tags instead. A missing step is how a component gets bypassed, so the step is
 * here rather than the bypass being there. The two lettered lockups have no display step to add
 * — §8.3's table stops at the forest band's 180px — so for them `xl` is the largest width the
 * kit names, which is what `lg` is.
 */
export type LockupSize = "xs" | "sm" | "md" | "lg" | "xl";

/** The kit's floor for the horizontal lockup, in CSS pixels. Below it, the mark. */
export const LOCKUP_MIN_WIDTH = 160;

/**
 * The artwork, by lockup and by the paint it is cut in.
 *
 *  - `primary` — ink lettering with the lime dot in the P's counter. Light grounds.
 *  - `inverse` — paper lettering, lime dot. **Dark grounds only.**
 *  - `ink`     — every module ink, the spark included. This is the one that goes on **lime**,
 *                where a lime dot would simply disappear. It is a kit file, not a recolour.
 *
 * The wordmark has no dot to spark, so its `primary` and `ink` cuts are the same file.
 */
const ARTWORK: Record<LockupVariant, Record<"primary" | "inverse" | "ink", string>> = {
  horizontal: {
    primary: "/brand/logo.svg",
    inverse: "/brand/logo-inverse.svg",
    ink: "/brand/logo-ink.svg",
  },
  mark: {
    primary: "/brand/mark.svg",
    inverse: "/brand/mark-inverse.svg",
    ink: "/brand/mark-ink.svg",
  },
  wordmark: {
    primary: "/brand/wordmark.svg",
    inverse: "/brand/wordmark-inverse.svg",
    ink: "/brand/wordmark.svg",
  },
};

/**
 * Which cut each ground takes, in each theme — the whole of "which artwork is legal where".
 *
 * | ground | light theme | dark theme | why |
 * |---|---|---|---|
 * | `paper`   | primary | inverse | the page. It flips with the theme, so the artwork does |
 * | `surface` | primary | inverse | a card, a well, the rail. Same flip |
 * | `forest`  | inverse | inverse | forest is dark in **both** themes — paper on forest, 8.63:1 |
 * | `signal`  | ink     | ink     | lime is light in **both** themes, and eats a lime spark |
 */
const GROUND: Record<BrandGround, { light: "primary" | "inverse" | "ink"; dark: "primary" | "inverse" | "ink" }> = {
  paper: { light: "primary", dark: "inverse" },
  surface: { light: "primary", dark: "inverse" },
  forest: { light: "inverse", dark: "inverse" },
  signal: { light: "ink", dark: "ink" },
};

/** The kit's canvases, in viewBox units. Aspect ratios: 4.507:1, 0.96:1, 3.934:1. */
const CANVAS: Record<LockupVariant, { width: number; height: number }> = {
  horizontal: { width: 685, height: 152 },
  mark: { width: 146, height: 152 },
  wordmark: { width: 535, height: 136 },
};

/**
 * The clear space owed, as a fraction of the rendered width.
 *
 * One circle diameter is 26 units and the files carry 16 of padding on every side, so 10 units
 * remain — and 10 units of a canvas `w` units wide is `10 / w` of whatever width it is rendered
 * at. That is the entire derivation, and it is why this is three numbers rather than a designer's
 * guess: `10/685`, `10/146`, `10/535`.
 */
const CLEAR: Record<LockupVariant, string> = {
  horizontal: "[--lockup-clear:0.0146]",
  mark: "[--lockup-clear:0.0685]",
  wordmark: "[--lockup-clear:0.0187]",
};

/**
 * The box: exactly the artwork's width, with the owed clear space added *outside* it
 * (`box-content`), so the number a caller asks for is the number the artwork is drawn at and the
 * padding is protection rather than shrinkage.
 */
const lockup = cva(
  [
    "inline-block shrink-0 box-content",
    "w-[var(--lockup-w)] p-[calc(var(--lockup-w)*var(--lockup-clear))]",
  ].join(" "),
  {
    variants: {
      variant: {
        horizontal: CLEAR.horizontal,
        mark: CLEAR.mark,
        wordmark: CLEAR.wordmark,
      },
      /** Widths arrive from the compound table below; the step alone carries no class. */
      size: { xs: "", sm: "", md: "", lg: "", xl: "" },
    },
    compoundVariants: [
      // The horizontal lockup. `sm` is the kit's 160px floor; `md` is the rail's 168px (a 236px
      // rail less two 32px gutters is 172px); `lg` is the landing's forest band. There is no
      // step below 160 — `xs` is resolved to the mark before this table is reached.
      { variant: "horizontal", size: "xs", class: "[--lockup-w:160px]" },
      { variant: "horizontal", size: "sm", class: "[--lockup-w:160px]" },
      { variant: "horizontal", size: "md", class: "[--lockup-w:168px]" },
      { variant: "horizontal", size: "lg", class: "[--lockup-w:180px]" },
      // 180px is the largest width §8.3's table names for the lettered lockup, so the display
      // step is that width rather than an invented one. A caller who wants the mark bigger than
      // the table goes asks for the *mark*, which is the lockup that has a display size.
      { variant: "horizontal", size: "xl", class: "[--lockup-w:180px]" },
      // The mark, in the sizes chrome asks for: a line of meta type, the rail's head, the
      // landing's footer, a loading state (§8.3, "collapsed rail / mobile header / loading").
      { variant: "mark", size: "xs", class: "[--lockup-w:16px]" },
      { variant: "mark", size: "sm", class: "[--lockup-w:20px]" },
      { variant: "mark", size: "md", class: "[--lockup-w:24px]" },
      { variant: "mark", size: "lg", class: "[--lockup-w:32px]" },
      // The display step: the mark as a page's own artwork rather than as chrome — the landing's
      // hero locator. 48px, and 56px once there is a second column to hold it, which is the size
      // the hero was already drawing by hand. The breakpoint is the ledger stub's own (`md`), so
      // the mark steps up exactly when the stub it sits in appears.
      { variant: "mark", size: "xl", class: "[--lockup-w:48px] md:[--lockup-w:56px]" },
      // The wordmark, for the rare surface that has the product's name but no room for its mark.
      { variant: "wordmark", size: "xs", class: "[--lockup-w:96px]" },
      { variant: "wordmark", size: "sm", class: "[--lockup-w:120px]" },
      { variant: "wordmark", size: "md", class: "[--lockup-w:160px]" },
      { variant: "wordmark", size: "lg", class: "[--lockup-w:200px]" },
      { variant: "wordmark", size: "xl", class: "[--lockup-w:200px]" },
    ],
    defaultVariants: { variant: "horizontal", size: "md" },
  },
);

/** The image fills the box exactly; the box owns the size and the clear space. */
const ART = "block h-auto w-full";

export interface LogoProps {
  /** Which lockup. Default `horizontal` — mark and wordmark together. */
  variant?: LockupVariant;
  /**
   * **The ground the artwork sits on**, which is what decides the artwork. Default `paper`.
   * There is deliberately no way to ask for "the inverse one": ask for the ground and the
   * component cannot put paper lettering on a paper page or a lime spark on a lime chip.
   */
  on?: BrandGround;
  /** Default `md`. For `horizontal`, `xs` is below the kit's floor and yields the mark instead. */
  size?: LockupSize;
  /**
   * The accessible name. Defaults to the product's name.
   *
   * Pass **`null`** whenever something around the artwork already names it — a link with its own
   * `aria-label`, a heading beside it, a footer whose text says what the product is. Two names
   * for one thing is the commonest way a logo goes wrong for a screen reader, so the decorative
   * case is spelled rather than assumed: `null` marks the whole box `aria-hidden`.
   */
  label?: string | null;
  className?: string;
  style?: CSSProperties;
}

export const Logo = forwardRef<HTMLSpanElement, LogoProps>(function Logo(
  { variant = "horizontal", on = "paper", size = "md", label = "Populace", className, style },
  ref,
) {
  /*
    The kit's floor, enforced rather than documented: below 160px the horizontal lockup is not
    legal artwork, and the kit's own instruction is to use the standalone mark. So `xs` on the
    horizontal lockup *is* the mark, at the 24px chrome size §8.3 gives it. This is a branch on a
    prop, which is fine; the branch this component never makes is on the theme.
  */
  const belowTheFloor = variant === "horizontal" && size === "xs";
  const art: LockupVariant = belowTheFloor ? "mark" : variant;
  const step: LockupSize = belowTheFloor ? "md" : size;

  const canvas = CANVAS[art];
  const cut = GROUND[on];
  const light = ARTWORK[art][cut.light];
  const dark = ARTWORK[art][cut.dark];
  /* A ground that is the same colour in both themes needs one image, not a pair that agrees. */
  const flips = light !== dark;

  return (
    <span
      ref={ref}
      className={cn(lockup({ variant: art, size: step }), className)}
      style={style}
      role={label === null ? undefined : "img"}
      aria-label={label === null ? undefined : label}
      aria-hidden={label === null ? true : undefined}
    >
      {/*
        Both artworks, and the cascade picks. `hidden` is `display: none`, which takes the image
        out of the accessibility tree as well as off the page, so the name on the box above is the
        only name either way — and the images themselves are never named.
      */}
      <img
        src={light}
        alt=""
        width={canvas.width}
        height={canvas.height}
        className={cn(ART, flips ? "dark:hidden" : "")}
      />
      {flips ? (
        <img
          src={dark}
          alt=""
          width={canvas.width}
          height={canvas.height}
          className={cn(ART, "hidden dark:block")}
        />
      ) : null}
    </span>
  );
});
