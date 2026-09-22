import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { forwardRef, useId, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, pressTransition, ringRoomX } from "../variants.js";
import { Heading, Icon, Mono, Text, VisuallyHidden } from "../atoms/index.js";
import { Ledger, LedgerRow } from "../organisms/index.js";

/**
 * WizardPanel — ATOMIC-INVENTORY §4, template 7. One screen (`GetStarted`, embedded in
 * `ProjectHome`).
 *
 * **It is a card, not a wizard**, and that is the thing the port must not lose. There is no
 * next/back chrome, no progress bar and no modal take-over: every step is visible as a line, one
 * is open, and a step that is done collapses to its own answer. A reader can see the whole shape
 * of what they are being asked before they answer any of it, and they can go back to a step by
 * clicking the line rather than by walking backwards through a flow.
 *
 * **The spine is the ledger's** (DESIGN-SYSTEM §1.2 M2), so the panel is visibly the same
 * instrument as every list in the product: a 72px stub carrying the step's locator — its number
 * in mono, or a tick once it is done — and one continuous rule at the stub's right edge. Nothing
 * else ever goes in that column.
 *
 * **Collapse-to-a-line, and the done summary.** A closed step shows its label and, when it has
 * one, the answer it holds — *"Checkout · 12 people"* — in the chrome register beside it. That is
 * the whole point of the collapse: a folded step that hides its answer asks to be opened to find
 * out whether opening it was worth it.
 *
 * **Exactly one step is open, and the panel cannot close all of them.** `openId` is a string, so
 * "nothing open" has no spelling in the props, and the trigger of the open step is inert rather
 * than a toggle that would move the reader to a state the caller cannot represent.
 *
 * **Nothing spends until the last step.** That is a guarantee about *what a screen puts in a
 * step's body*, and it cannot be enforced from here — a template owns layout and knows no product
 * noun. What the template does is make the guarantee visible: the steps are numbered, the last
 * one is the last line of the ledger, and the act lives in its body rather than in any chrome the
 * template draws. The panel itself renders no button of its own.
 *
 * **Heading order, and the `<h2>` this template owns.** `GetStarted` has no `<h1>` — it is a
 * panel inside `ProjectHome`, not a screen — and each step's label is an `<h3>`. An `<h3>` with
 * no `<h2>` above it is a skipped level, so DESIGN-SYSTEM §6 and the inventory's page map both
 * say the same thing about this one panel: *"it has no `h1`; the template gives it an explicit
 * `<h2>`"* — **explicitly, rather than by accident of where it is embedded**. That is why
 * `title` is required here and is not a `ReactNode`: the heading is a name, it always renders,
 * and a screen cannot forget it. It follows that the panel is **not** wrapped in a `Section`:
 * that would put two `<h2>`s on one thing.
 *
 * Motion is §5.1's disclosure: 160ms of height and opacity, drawn as a grid track going `0fr` →
 * `1fr`, because `height: auto` does not interpolate and a number typed by hand would be wrong
 * for every step.
 */

/** The fold. Same mechanism as the `Disclosure` molecule — see its note for why. */
const FOLD = [
  "grid grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
  "invisible data-[state=open]:visible",
  "opacity-0 data-[state=open]:opacity-100",
  "transition-[grid-template-rows,opacity,visibility]",
  "[transition-duration:var(--dur-disclose)]",
  "[transition-timing-function:var(--ease)]",
].join(" ");

/**
 * The trigger fills the content column so the whole line is the target, and it carries the
 * shared focus ring like every other focusable thing in the system.
 */
const TRIGGER = [
  "flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left",
  "rounded-sm hover:text-ink-muted",
  pressTransition,
  focusRing,
].join(" ");

export interface WizardStep {
  id: string;
  /** Sentence case. What the step asks for, in the product's own words. */
  label: string;
  /** Answered. The stub's number becomes a tick. */
  done: boolean;
  /** The answer, shown on the line while the step is closed. A fact, never a control. */
  summary?: ReactNode;
  /** The step's fields. Mounted for every step, so an answer survives a step being folded. */
  body: ReactNode;
}

export interface WizardPanelProps {
  /** The panel's own `<h2>`. Sentence case — it is a name, like a `Section`'s. */
  title: string;
  steps: readonly WizardStep[];
  /** The one open step. There is no spelling for "none open", by construction. */
  openId: string;
  onOpen: (id: string) => void;
}

export const WizardPanel = forwardRef<HTMLElement, WizardPanelProps>(function WizardPanel(
  { title, steps, openId, onOpen },
  ref,
) {
  const scope = useId();
  const titleId = `${scope}-title`;

  return (
    // A named region rather than a bare wrapper: the heading is what names it, so an outline
    // reader meets "Get started" and then its steps rather than three unattached `<h3>`s.
    <section ref={ref} aria-labelledby={titleId}>
      <Heading level={2} id={titleId} className="mb-3">
        {title}
      </Heading>
      <Ledger as="ol" stubLabel="Step">
        {steps.map((step, index) => {
          const open = step.id === openId;
          const labelId = `${scope}-${step.id}-label`;

          return (
            <LedgerRow
              key={step.id}
              stub={
                step.done ? (
                  <>
                    <Icon name="check" size={16} className="text-primary" />
                    {/* The tick replaces the number, so the number is still said. */}
                    <VisuallyHidden>{`Step ${index + 1}, done`}</VisuallyHidden>
                  </>
                ) : (
                  <Mono size="ref" tone={open ? "ink" : "muted"}>
                    {String(index + 1).padStart(2, "0")}
                  </Mono>
                )
              }
            >
              <CollapsiblePrimitive.Root
                open={open}
                onOpenChange={(next) => {
                  // Closing the open step would leave no step open, which `openId` cannot express.
                  if (next) onOpen(step.id);
                }}
              >
                <Heading level={3} id={labelId} className="m-0">
                  <CollapsiblePrimitive.Trigger className={cn(TRIGGER)}>
                    <span className="min-w-0">{step.label}</span>
                    {open || step.summary === undefined ? null : (
                      <Text size="meta" tone="muted" as="span" className="min-w-0">
                        {step.summary}
                      </Text>
                    )}
                  </CollapsiblePrimitive.Trigger>
                </Heading>

                {/* `group` rather than `region`: a step is not a landmark, but it is named. */}
                <CollapsiblePrimitive.Content
                  forceMount
                  role="group"
                  aria-labelledby={labelId}
                  className={cn(FOLD)}
                >
                  {/*
                    Two wrappers: the outer is the grid item and must be able to shrink below its
                    content and clip it; the inner carries the gap, because padding on a `0fr`
                    track keeps the fold from closing its last few pixels. The outer clips both
                    axes though only the vertical clip is wanted, so `ringRoomX` gives a focused
                    control inside the step the sides of its ring back.
                  */}
                  <div className={cn("min-h-0 overflow-hidden", ringRoomX)}>
                    {/* `pb-1` is the ring's room at the foot; see `Disclosure` for why it is
                        real padding here rather than a cancelled pair. */}
                    <div className="pt-3 pb-1">{step.body}</div>
                  </div>
                </CollapsiblePrimitive.Content>
              </CollapsiblePrimitive.Root>
            </LedgerRow>
          );
        })}
      </Ledger>
    </section>
  );
});
