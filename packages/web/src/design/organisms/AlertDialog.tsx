import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { forwardRef, type ComponentRef, type ReactElement, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, surfaceBase } from "../variants.js";
import { Button, Heading, Inline, Spacer, Stack, Text } from "../atoms/index.js";

/**
 * AlertDialog — ATOMIC-INVENTORY §3, organism 7. Radix `react-alert-dialog`. Four sites, all of
 * them destructive: remove a persona (which takes its cohorts with it), delete a project, delete
 * a simulation, re-cast a whole population.
 *
 * **The destructive grammar, stated once.** DESIGN-SYSTEM §1.2 makes `danger` deliberately *not*
 * a filled red button: "a destructive act goes through a `Dialog`, so the button itself only
 * needs to name the risk, not shout it". This organism is the other half of that decision — the
 * colour is quiet because the interruption is loud. Three things follow, and all three are
 * checked in review:
 *
 *  1. **The question is asked, not asserted.** `title` is the question, in serif, because the
 *     product is speaking (§4.7). `body` states what actually happens — with the number, per
 *     §7.4: "Nine people and their nine accounts", not "This cannot be undone".
 *  2. **`confirmLabel` names the act** — "Delete this project", "Re-cast all of them". Never
 *     "OK", never "Confirm", never "Yes". The cancel is the quiet default and it keeps the focus
 *     on open, so the dangerous button is never one stray Enter away.
 *  3. **Nothing promises an outcome** (§7.3). These four acts change the world; none of them is
 *     a repair, and the copy at each call site says what it did, not what it fixed.
 *
 * **Why `AlertDialog` and not `Dialog`.** An alert dialog is announced as `alertdialog`, traps
 * focus in its own content, and **refuses to close on an outside click** — which is the whole
 * difference between "here is a panel" and "answer this before anything else happens". Escape,
 * the focus trap and focus return to the trigger all come free.
 *
 * **It opens two ways, and the second one is why the kill switch is now announced properly.**
 * Most destructive acts are a click on a button the caller already holds, so the caller hands
 * over the `trigger` and Radix owns the rest. But the product's single most destructive control
 * is a `Switch` — turning the kill switch *on* stops every execution on the machine — and a
 * switch is not a slotted trigger. With no controlled `open` to drive, that confirm shipped as a
 * plain `Dialog`: announced as `dialog` rather than `alertdialog`, and dismissible by a click on
 * the scrim, which are precisely the two properties the question needed. `open`/`onOpenChange`
 * close that, and `confirmPending` lets the panel stay up while the answer is in flight.
 *
 * **Elevation is a composite token, never a theme branch** (§2.5, §6.2). `surfaceBase({ level:
 * "overlay" })` gives 12px radius, the `surface` ground, `--shadow-over`, and a boundary that is
 * a hairline in light and `rule-strong` in dark — dark elevation is border-led, because
 * `#2C3730` on `#202823` is 1.22:1 and no fill difference will read there.
 *
 * Related but not the same: `ConfirmButton` (molecule 31) is the single-button convenience that
 * owns its own trigger *and* its pending state. Reach for that when a button is the whole
 * interaction; reach for this when the caller already holds the trigger element.
 */

/**
 * The scrim, as a wash of a *token* rather than of a hard-coded ground — which is what §0.2's
 * rule actually forbids. It is spelled twice because a scrim must DARKEN and the two themes keep
 * their darkest value under different names: in light that is `ink` (#202823); in dark, `ink` is
 * the paper-coloured text, so a wash of it would be a white veil, and `sunk` is the one token
 * below the dark page ground. A `dark:` utility, in CSS, with no branch in TypeScript.
 *
 * The backdrop is decorative and carries no text, so §6's own exemption list covers it.
 */
const scrim = cn(
  "populace-alert-scrim fixed inset-0 z-[var(--z-dialog)]",
  "bg-ink/45 dark:bg-sunk/75",
);

/**
 * Narrower than `Dialog`'s 38rem. A destructive question is two sentences and two buttons; a
 * panel wider than its content reads as a form, and this is not one.
 */
const panel = cn(
  "populace-alert",
  surfaceBase({ level: "overlay" }),
  focusRing,
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "z-[var(--z-dialog)]",
  "w-[min(30rem,calc(100vw-2rem))] p-5",
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out — 0.75× the entry — on `--ease-exit`. The scrim fades only.
 *
 * Under `prefers-reduced-motion` theme.css collapses the durations to 0.01ms, and
 * `animation-fill-mode: both` holds the panel at its final frame, so it simply appears.
 */
const ALERT_CSS = `
.populace-alert[data-state="open"] {
  animation: populace-alert-in var(--dur-enter) var(--ease) both;
}
.populace-alert[data-state="closed"] {
  animation: populace-alert-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}
.populace-alert-scrim[data-state="open"] {
  animation: populace-alert-scrim-in var(--dur-enter) var(--ease) both;
}
.populace-alert-scrim[data-state="closed"] {
  animation: populace-alert-scrim-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-alert-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes populace-alert-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes populace-alert-scrim-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes populace-alert-scrim-out { from { opacity: 1; } to { opacity: 0; } }
`;

interface AlertDialogBaseProps {
  /** The question, in serif — "Delete this project?" */
  title: string;
  /** What actually happens if they say yes, with the number. One or two sentences. */
  body: ReactNode;
  /** Names the act — "Delete this project". Never "Confirm", never "OK". */
  confirmLabel: string;
  /** Defaults to "Cancel", which is the one place a generic word is the right word. */
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  /**
   * The act takes time and the caller is holding its state.
   *
   * Setting it AT ALL — `true` or `false` — says the panel is not finished when the button is
   * pressed: the confirm no longer closes on click, the button shows its `Spinner` in place of
   * its label while the work is in flight, and the caller closes the panel when the work lands,
   * which it does by owning `open`. Leaving it out is the ordinary case, where confirming is the
   * end of the interaction and Radix closes on the click.
   */
  confirmPending?: boolean;
}

/**
 * How the panel is opened, and the two forms are exclusive in the way that matters.
 *
 * The trigger-driven form is the one the four destructive acts in §3 use: the caller hands over
 * the button and Radix owns the open state, the `aria-expanded` wiring and the focus return. The
 * controlled form is for an interruption whose cause is not a click on a slotted element — the
 * kill switch is a `Switch`, and turning it *on* asks this question — and for one whose answer
 * takes time.
 *
 * `open?: never` on the first branch is load-bearing, exactly as `DataTable`'s `sortable?: never`
 * is: a branch that merely omitted the property would still swallow a half-controlled object
 * handed in through a variable, and a panel with an `open` prop that nothing reads is a panel
 * that will not close.
 */
type AlertDialogOpening =
  | { trigger: ReactElement; open?: never; onOpenChange?: never }
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      /** Optional here: a controlled panel may still have a button that opens it. */
      trigger?: ReactElement;
    };

export type AlertDialogProps = AlertDialogBaseProps & AlertDialogOpening;

export const AlertDialog = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogProps
>(function AlertDialog(
  {
    title,
    body,
    confirmLabel,
    cancelLabel = "Cancel",
    tone = "danger",
    confirmPending,
    onConfirm,
    trigger,
    open,
    onOpenChange,
  },
  ref,
) {
  return (
    // `open` undefined is what Radix reads as "uncontrolled", so the trigger-driven form passes
    // through this untouched and keeps every behaviour it had.
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger === undefined ? null : (
        <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      )}

      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={scrim} />
        <AlertDialogPrimitive.Content ref={ref} className={panel}>
          <Stack gap={4}>
            <Stack gap={2}>
              {/*
                `PageHeader` owns the page's single `<h1>`, so a panel floating above it starts
                at `<h2>` (§6, heading order). The product asks the question, so the question is
                serif (§4.7).
              */}
              <AlertDialogPrimitive.Title asChild>
                <Heading level={2} size="lede">
                  {title}
                </Heading>
              </AlertDialogPrimitive.Title>

              {/*
                `div`, not `p`: the consequence is usually a sentence plus a figure or a name.
                `Text` is what takes the `asChild`, because Radix puts the id that
                `aria-describedby` points at onto whatever it slots into, and `Measure` has no
                `id` prop to receive it. The panel's own 30rem cap already holds the line length
                inside the reading measure.
              */}
              <AlertDialogPrimitive.Description asChild>
                <Text size="read" tone="soft" as="div">
                  {body}
                </Text>
              </AlertDialogPrimitive.Description>
            </Stack>

            {/*
              Cancel sits before the act, and Radix gives it the initial focus, so the dangerous
              button is never one stray Enter away from a keyboard that arrived here by accident.
            */}
            <Inline gap={2} align="center">
              <Spacer />
              <AlertDialogPrimitive.Cancel asChild>
                <Button variant="secondary">{cancelLabel}</Button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                {/*
                  An act that takes time keeps the panel: `preventDefault` on the Action stops
                  Radix closing it, so the reader sees the work rather than a panel that vanishes
                  and a page that has not changed yet. The caller closes it when the work lands.
                */}
                <Button
                  variant={tone}
                  pending={confirmPending === true}
                  onClick={(event) => {
                    if (confirmPending !== undefined) event.preventDefault();
                    onConfirm();
                  }}
                >
                  {confirmLabel}
                </Button>
              </AlertDialogPrimitive.Action>
            </Inline>
          </Stack>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>

      {/* React 19 hoists and de-duplicates this by `href`, so N dialogs emit one rule set. */}
      <style href="populace-alert" precedence="medium">
        {ALERT_CSS}
      </style>
    </AlertDialogPrimitive.Root>
  );
});
