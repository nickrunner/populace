import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, surfaceBase } from "../variants.js";
import { Heading, IconButton, Inline, Spacer, Stack, Text } from "../atoms/index.js";

/**
 * Dialog — ATOMIC-INVENTORY §3, organism 6. Radix `react-dialog`. Six sites, and **zero dialogs
 * exist in the product today**: every interruption is currently an inline panel that pushes the
 * page around, or a `window.confirm`.
 *
 * **What this one is for, and what it is not.** This is the *non-destructive* interruption — an
 * editor, a picker, a thing you are composing. A destructive act does not come here; it goes to
 * `AlertDialog`, which refuses an outside click and is announced as `alertdialog` rather than as
 * `dialog`. The distinction is the whole reason there are two files.
 *
 * **Elevation is a composite token, never a theme branch** (DESIGN-SYSTEM §2.5, §6.2). The panel
 * takes `surfaceBase({ level: "overlay" })`: 12px radius (§5.2 — a dialog is a container),
 * `surface` ground, `--shadow-over`, and a boundary that is a hairline in light and
 * `rule-strong` in dark. Dark elevation is **border-led** — `--c-shadow-card` is literally
 * `none` there and `--shadow-over` is a deeper, softer black — because `#2C3730` on `#202823` is
 * 1.22:1 and no fill difference will read. Nothing here asks TypeScript what the theme is.
 *
 * **Copy** (§7.4). The title is the product speaking, so it is serif; `description` is the one
 * sentence that says what the panel is for, and it is what `aria-describedby` points at. The
 * footer's buttons name the act in the product's own words — "Send them in", "Save this cohort"
 * — never "Submit" or "OK", and nothing here may promise a repeatable outcome (§7.3).
 */

/**
 * The scrim, as a wash of a *token* rather than of a hard-coded ground — which is what §0.2's
 * rule actually forbids. It is spelled twice because a scrim must DARKEN and the two themes keep
 * their darkest value under different names: in light that is `ink` (#202823); in dark, `ink` is
 * the paper-coloured text, so a wash of it would be a white veil, and `sunk` is the one token
 * below the dark page ground. A `dark:` utility, in CSS, with no branch in TypeScript.
 *
 * The backdrop is decorative and carries no text, so §6's own exemption list covers it. This is
 * the same recipe `ConfirmButton` uses, deliberately: two overlay scrims that differ by a few
 * percent read as a bug.
 */
const scrim = cn(
  "populace-dialog-scrim fixed inset-0 z-[var(--z-dialog)]",
  "bg-ink/45 dark:bg-sunk/75",
);

/**
 * `100dvh` rather than `100vh`: on iOS the browser chrome collapses, and a panel sized to `vh`
 * puts its footer under the URL bar exactly when someone reaches for the button in it.
 */
const panel = cn(
  "populace-dialog",
  surfaceBase({ level: "overlay" }),
  focusRing,
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "z-[var(--z-dialog)]",
  "flex flex-col",
  "w-[min(38rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] p-5",
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out — 0.75× the entry — on `--ease-exit`. The scrim fades only; a moving backdrop drags the
 * eye away from the thing it exists to reveal.
 *
 * Under `prefers-reduced-motion` theme.css collapses the durations to 0.01ms, and
 * `animation-fill-mode: both` holds the panel at its final frame, so it simply appears. That is
 * why the travel is an animation rather than a transition: there is a final frame to hold.
 */
const DIALOG_CSS = `
.populace-dialog[data-state="open"] {
  animation: populace-dialog-in var(--dur-enter) var(--ease) both;
}
.populace-dialog[data-state="closed"] {
  animation: populace-dialog-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}
.populace-dialog-scrim[data-state="open"] {
  animation: populace-dialog-scrim-in var(--dur-enter) var(--ease) both;
}
.populace-dialog-scrim[data-state="closed"] {
  animation: populace-dialog-scrim-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-dialog-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes populace-dialog-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes populace-dialog-scrim-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes populace-dialog-scrim-out { from { opacity: 1; } to { opacity: 0; } }
`;

export interface DialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The question or the job, in the product's own words. Serif — the product is speaking. */
  title: string;
  /** One sentence saying what the panel is for. Wired to `aria-describedby`. */
  description?: string;
  children: ReactNode;
  /** The act and its escape, right-aligned. Buttons name the act, never "Submit". */
  footer?: ReactNode;
}

export const Dialog = forwardRef<ComponentRef<typeof DialogPrimitive.Content>, DialogProps>(
  function Dialog({ open, onOpenChange, title, description, children, footer }, ref) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={scrim} />
          {/*
            No `aria-describedby` is spelled here on purpose: this version of Radix tracks
            whether a `Description` was rendered and drops the attribute when none was. A dialog
            whose title already says everything gets no invented sentence — §7.4: the product
            reports, it does not pad.
          */}
          <DialogPrimitive.Content ref={ref} className={panel}>
            <Stack gap={4} className="min-h-0">
              <Stack gap={2}>
                <Inline gap={3} align="start">
                  {/*
                    `PageHeader` owns the page's single `<h1>`, so a panel floating above it
                    starts at `<h2>` (§6, heading order). `lede` is the serif step a dialog
                    title takes: large enough to be the first thing read, small enough that a
                    two-line title does not become a masthead.
                  */}
                  <DialogPrimitive.Title asChild>
                    <Heading level={2} size="lede" className="flex-1">
                      {title}
                    </Heading>
                  </DialogPrimitive.Title>
                  {/*
                    Escape already closes this, and so does the scrim. The glyph is here because
                    a pointer user should not have to know that. `IconButton` carries both an
                    `aria-label` and a `Tooltip`, which is what §6 asks of every bare glyph.
                  */}
                  <DialogPrimitive.Close asChild>
                    <IconButton icon="x" label="Close" size="sm" className="-mr-1 -mt-0.5" />
                  </DialogPrimitive.Close>
                </Inline>

                {description === undefined ? null : (
                  /*
                    `div`, not `p`: a description is often a sentence plus a figure or a name.
                    `Text` is what takes the `asChild`, because Radix puts the id that
                    `aria-describedby` points at onto whatever it slots into, and `Measure` has
                    no `id` prop to receive it. The panel's own 38rem cap already holds the line
                    length inside the reading measure.
                  */
                  <DialogPrimitive.Description asChild>
                    <Text size="read" tone="soft" as="div">
                      {description}
                    </Text>
                  </DialogPrimitive.Description>
                )}
              </Stack>

              {/*
                Only the body scrolls. A panel that scrolls as a whole takes its own footer out
                of reach, which is the failure mode of every long form in a modal. `min-h-0` is
                what lets a flex child actually shrink instead of overflowing its parent.
              */}
              <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

              {footer === undefined ? null : (
                <Inline gap={2} align="center">
                  <Spacer />
                  {footer}
                </Inline>
              )}
            </Stack>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>

        {/* React 19 hoists and de-duplicates this by `href`, so N dialogs emit one rule set. */}
        <style href="populace-dialog" precedence="medium">
          {DIALOG_CSS}
        </style>
      </DialogPrimitive.Root>
    );
  },
);
