import { cva, type VariantProps } from "class-variance-authority";

/**
 * The shared CVA fragments — ATOMIC-INVENTORY §0.1.
 *
 * Four things every layer above reuses rather than re-rolls: the focus ring, the control shell,
 * the ledger row and the elevation surface. Three house rules bind everything in this file:
 *
 *  - **Every variant is written against a token.** No hex, no `text-white`, no alpha over a hard
 *    ground. `primary` and `accent` swap identities between themes, so a literal would break the
 *    dark theme silently.
 *  - **No component branches on the theme in TypeScript.** Where light and dark genuinely differ
 *    in structure rather than in value — dark's shadow is `none`, dark's overlay border is
 *    `rule-strong` — the flip is a composite token or a `dark:` utility, never a `useTheme()`.
 *  - **Motion is a token.** 90ms for a press or a hover, 140ms for a control's state change.
 */

/**
 * The one focus ring (§4.6). `--color-focus` equals `--color-primary` in both themes, so a plain
 * ring on a primary button would be invisible; this is a two-part ring — 2px of the ground
 * colour, then 2px of focus — and `box-shadow` inherits `border-radius`, so it is correct on a
 * square row, a 6px control, a 12px card and a full-round avatar with no per-shape work.
 *
 * Every focusable atom applies this. Nothing rolls its own. A component sitting on a non-page
 * ground sets `--focus-sep` on its container so the separator band is the colour immediately
 * behind the control; `surfaceBase` already does that for cards, wells and overlays.
 */
export const focusRing = "focus-ring";

/** Colour-only transitions at the press tempo — hover, active, selected (§5.1). */
export const pressTransition =
  "transition-colors [transition-duration:var(--dur-press)] [transition-timing-function:var(--ease)]";

/** Colour-only transitions at the state tempo — a control taking or losing a value (§5.1). */
export const stateTransition =
  "transition-colors [transition-duration:var(--dur-state)] [transition-timing-function:var(--ease)]";

/**
 * **The 4px a focus ring needs, given back to it by a box that clips.**
 *
 * `focus-ring` is a `box-shadow` — 2px of the ground, then 2px of focus — so it is drawn
 * *outside* the control's border box and contributes nothing to layout. That is what makes it
 * correct on every shape in the system with no per-shape work, and it is also its one hazard: a
 * `box-shadow` is painted overflow, and **painted overflow is clipped by any ancestor that is
 * not `overflow: visible`**. A control lying flush against the edge of a scroll container or a
 * fold therefore focuses with two or three sides of its ring and no fourth, which reads as a
 * rendering fault rather than as focus — and it is how the product shipped: the dialog's fields,
 * every row in the rail, and everything inside a `Disclosure`.
 *
 * The remedy is 4px of padding on the clipping box, taken straight back with an equal negative
 * margin. The margin box is unchanged, so **nothing on the page moves**; the clip boundary moves
 * out by exactly the ring. `ringRoom` is all four sides, for a box that clips on both axes;
 * `ringRoomX` is the inline pair, for a fold whose vertical clip is the whole point of it and
 * must not be loosened.
 *
 * It is not the answer everywhere. Where a clipping box has real padding already — a popover's
 * `p-4`, a menu panel's `p-1` — the room is there and this adds nothing. And where the controls
 * inside are deliberately full-bleed, as the rail's rows are, the fix is to inset the rows by
 * the ring instead, because widening the scroller would push it past the column that holds it.
 */
export const ringRoom = "-m-1 p-1";

/** `ringRoom`, inline axis only. See above. */
export const ringRoomX = "-mx-1 px-1";

/**
 * The control shell: inputs, selects, textareas, the secondary button, the segmented control.
 *
 * `rule-strong` rather than `rule`, because the kit's hairline is 1.37–2.62:1 and WCAG 1.4.11
 * asks 3:1 of anything that bounds an interactive element. The ground flips structurally — a
 * control is lighter than the page in light and *darker* than it in dark (§2.5) — which is the
 * one place a `dark:` utility earns its keep.
 *
 * Disabled is carried by colour tokens rather than by opacity, so it stays legible on every
 * ground. A disabled control that needs explaining uses `aria-disabled` plus a `Tooltip`.
 */
export const control = cva(
  [
    "t-ui text-ink",
    "rounded-sm border border-rule-strong",
    "bg-surface dark:bg-sunk",
    "placeholder:text-ink-muted",
    stateTransition,
    focusRing,
    "disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-muted",
  ].join(" "),
  {
    variants: {
      /** 24 / 32 / 40px, the three control heights the inventory names. */
      size: {
        sm: "h-6 px-2",
        md: "h-8 px-2.5",
        lg: "h-10 px-3",
      },
      /** Paired with `aria-invalid` on the control and a `role="alert"` message. */
      invalid: {
        true: "border-critical",
        false: "",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { size: "md", invalid: false, fullWidth: false },
  },
);

export type ControlVariants = VariantProps<typeof control>;

/**
 * A row in a ledger — the transcript, the findings list, the executions history, the visits
 * table, the live feed (§1.2 M2).
 *
 * Square, always: a 6px radius on a 22px row is 27% of its height, which turns the row into a
 * lozenge and dissolves the list. Separation is the ledger's one continuous spine, drawn by the
 * list, not per-row borders drawn here. No zebra — a tinted ground means machine output,
 * selection or hover, and nothing else (§1.3 rule 7).
 */
export const rowBase = cva(["relative w-full rounded-none text-left", pressTransition].join(" "), {
  variants: {
    /** `default` is the list row at py-3.5; `tight` is the 32px table and transcript row. */
    density: {
      default: "py-3.5",
      tight: "py-2",
    },
    interactive: {
      true: `cursor-pointer hover:bg-hover ${focusRing}`,
      false: "",
    },
    /** A selected row takes the wash and a 3px edge — the only 3px border in the system. */
    selected: {
      true: "bg-primary-wash border-l-[3px] border-l-primary",
      false: "",
    },
  },
  defaultVariants: { density: "default", interactive: false, selected: false },
});

export type RowVariants = VariantProps<typeof rowBase>;

/**
 * Elevation, as the five levels of §2.5's table.
 *
 * `shadow-card` and `shadow-over` are composite tokens whose values flip in the cascade —
 * `--c-shadow-card` is literally `none` in dark, because `#2C3730` on `#202823` is 1.22:1 and no
 * fill difference will read there, so the hairline does all of it. That is why nothing here asks
 * TypeScript what the theme is.
 *
 * Each raised level also publishes `--focus-sep`, so a control focused inside it draws its
 * separator band in the colour immediately behind it rather than in the page's.
 */
export const surfaceBase = cva("", {
  variants: {
    level: {
      /** The default, and most of the app: no fill, no border. The list draws the hairline. */
      flat: "",
      /** A discrete record you can open. */
      card: "rounded-md bg-surface border border-rule shadow-card [--focus-sep:var(--color-surface)]",
      /** Machine output: recessed, square, with the system's only 2px content border. */
      well: "rounded-none bg-sunk border border-rule border-l-2 border-l-evidence [--focus-sep:var(--color-sunk)]",
      /** Dialog, popover, menu, tooltip, toast. */
      overlay:
        "rounded-md bg-surface border border-rule dark:border-rule-strong shadow-over [--focus-sep:var(--color-surface)]",
    },
    /** A card you can click gains the stronger boundary and the hover ground. */
    interactive: {
      true: `cursor-pointer hover:border-rule-strong hover:bg-hover ${pressTransition} ${focusRing}`,
      false: "",
    },
  },
  defaultVariants: { level: "flat", interactive: false },
});

export type SurfaceVariants = VariantProps<typeof surfaceBase>;
