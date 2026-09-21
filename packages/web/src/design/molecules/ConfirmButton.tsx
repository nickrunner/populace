import { forwardRef, isValidElement, useEffect, useState, type ReactNode } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "../cn.js";
import { surfaceBase } from "../variants.js";
import { Button, Heading, Inline, Spacer, Stack, Text } from "../atoms/index.js";

/**
 * ConfirmButton — ATOMIC-INVENTORY §2, molecule 31. Radix `AlertDialog`. New; 4 sites, all of
 * them destructive: sweep the accounts an execution made, delete a project, delete a simulation,
 * re-cast a population.
 *
 * **Why the dialog exists at all.** DESIGN-SYSTEM §1.2's `danger` button is deliberately *not* a
 * filled red one: "a destructive act goes through a `Dialog`, so the button itself only needs to
 * name the risk, not shout it". This molecule is the other half of that decision. The colour is
 * quiet because the interruption is loud.
 *
 * **Why `AlertDialog` and not `Dialog`.** An alert dialog takes focus to its own content, traps
 * it, refuses to close on an outside click, and is announced as `alertdialog` — which is the
 * difference between "here is a panel" and "answer this before anything else happens". Escape
 * and focus return come free.
 *
 * **The copy is the product's own words** (§7.4). `confirmLabel` names the act — "Delete this
 * project", "Send them in again" — never "OK", never "Confirm", never "Submit". The dialog asks
 * a question in serif, because it is the product speaking (§4.7), and states the consequence
 * underneath it in the reading step. Nothing here promises a repeatable outcome (§7.3): the four
 * acts that use it change the world, and the copy for each lives at its call site.
 */

/** 12px radius, `surface` ground, hairline in light and `rule-strong` in dark, overlay shadow. */
const panel = cn(
  "populace-confirm",
  surfaceBase({ level: "overlay" }),
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "z-[var(--z-dialog)]",
  "w-[min(30rem,calc(100vw-2rem))] p-5",
);

/**
 * The scrim, as a wash of a token rather than of a hard-coded ground — which is what §0.2's rule
 * actually forbids. It has to be spelled twice, because a scrim must DARKEN and the two themes
 * put their darkest value under different names: in light that is `ink` (#202823), and in dark
 * `ink` is the paper-coloured text, so a wash of it would be a white veil. `sunk` is the one
 * token below the dark page ground, so dark washes that instead. A `dark:` utility, in CSS,
 * with nothing branching on the theme in TypeScript.
 *
 * The backdrop is decorative and carries no text, so §6's own exemption list covers it.
 */
const scrim = cn(
  "populace-confirm-scrim fixed inset-0 z-[var(--z-dialog)]",
  "bg-ink/45 dark:bg-sunk/75",
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out — 0.75× the entry — on `--ease-exit`. The scrim fades only; a moving backdrop would drag
 * the eye away from the thing it is meant to reveal.
 *
 * Under `prefers-reduced-motion`, `theme.css` collapses the durations to 0.01ms and
 * `animation-fill-mode: both` leaves the panel at its final frame, so it simply appears. That is
 * why the travel is an animation and not a transition: there is a final frame to hold.
 */
const CONFIRM_CSS = `
.populace-confirm[data-state="open"] {
  animation: populace-confirm-in var(--dur-enter) var(--ease) both;
}
.populace-confirm[data-state="closed"] {
  animation: populace-confirm-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}
.populace-confirm-scrim[data-state="open"] {
  animation: populace-confirm-scrim-in var(--dur-enter) var(--ease) both;
}
.populace-confirm-scrim[data-state="closed"] {
  animation: populace-confirm-scrim-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-confirm-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes populace-confirm-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes populace-confirm-scrim-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes populace-confirm-scrim-out { from { opacity: 1; } to { opacity: 0; } }
`;

export interface ConfirmButtonProps {
  /** The question, in serif — "Delete this project?" */
  title: string;
  /** What actually happens if they say yes. One or two sentences, in the reading step. */
  body: ReactNode;
  /** Names the act, in the product's own words — "Delete this project". Never "Confirm". */
  confirmLabel: string;
  onConfirm: () => void;
  variant?: "danger" | "primary";
  /**
   * The act is in flight. The confirm button shows its `Spinner` and the dialog refuses to
   * close, so a second press cannot send a second one. Leave it undefined for a synchronous act
   * and the dialog closes as soon as `onConfirm` returns.
   */
  pending?: boolean;
  /**
   * The trigger. A single element — a `Button`, an `IconButton`, a `Chip` — is slotted in and
   * keeps its own appearance. Anything else (a bare string, a fragment) is wrapped in a `Button`
   * of the same `variant`, so `<ConfirmButton …>Delete</ConfirmButton>` is a complete call.
   */
  children: ReactNode;
}

export const ConfirmButton = forwardRef<HTMLButtonElement, ConfirmButtonProps>(
  function ConfirmButton(
    { title, body, confirmLabel, onConfirm, variant = "danger", pending, children },
    ref,
  ) {
    const [open, setOpen] = useState(false);

    // Set the moment the act is sent, cleared when it lands. It is what tells the effect below
    // that a `pending` of `false` means "finished" rather than "not started".
    const [sent, setSent] = useState(false);

    // Radix's own `Action` closes on click, which would hide the pending state before it could
    // be seen and would let a second press through the moment the dialog reopened. So the close
    // is ours: it happens when the caller's `pending` falls back to false — immediately for a
    // synchronous act, and after the request for an asynchronous one.
    useEffect(() => {
      if (!sent) return;
      if (pending === true) return;
      setSent(false);
      setOpen(false);
    }, [sent, pending]);

    function handleOpenChange(next: boolean): void {
      // An act in flight is not interruptible: Escape and the Cancel button both wait for it.
      if (!next && pending === true) return;
      setOpen(next);
    }

    const slotted = isValidElement(children);

    return (
      <AlertDialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        {/*
          The ref rides on the Trigger rather than on the fallback `Button`, so a caller holds a
          handle on whatever actually opens the dialog — their own slotted element just as much
          as the one this molecule supplies. `asChild` merges it onto the child either way.
        */}
        <AlertDialogPrimitive.Trigger asChild ref={ref}>
          {slotted ? children : <Button variant={variant}>{children}</Button>}
        </AlertDialogPrimitive.Trigger>

        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay className={scrim} />
          <AlertDialogPrimitive.Content
            className={panel}
            onEscapeKeyDown={(event) => {
              if (pending === true) event.preventDefault();
            }}
          >
            <Stack gap={4}>
              <Stack gap={2}>
                {/* The product asks the question, so the question is serif (§4.7). */}
                <AlertDialogPrimitive.Title asChild>
                  <Heading level={2} size="lede">
                    {title}
                  </Heading>
                </AlertDialogPrimitive.Title>

                {/*
                  `div`, not `p`: the consequence is often a sentence plus a figure or a name.
                  `Text` is what carries the `asChild`, because Radix puts the id that
                  `aria-describedby` points at onto whatever it slots into, and `Measure` has no
                  `id` prop to receive it. No `Measure` is needed anyway — the panel's own
                  30rem cap already holds the line length to the reading measure.
                */}
                <AlertDialogPrimitive.Description asChild>
                  <Text size="read" tone="soft" as="div">
                    {body}
                  </Text>
                </AlertDialogPrimitive.Description>
              </Stack>

              <Inline gap={2} align="center">
                <Spacer />
                <AlertDialogPrimitive.Cancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogPrimitive.Cancel>
                <AlertDialogPrimitive.Action asChild>
                  <Button
                    variant={variant}
                    pending={pending === true}
                    onClick={(event) => {
                      // We close on our own terms; see the effect above.
                      event.preventDefault();
                      setSent(true);
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
        <style href="populace-confirm" precedence="medium">
          {CONFIRM_CSS}
        </style>
      </AlertDialogPrimitive.Root>
    );
  },
);
