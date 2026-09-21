import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Mono, VisuallyHidden } from "../atoms/index.js";

/**
 * CallRef — the locator half of the evidence seam (DESIGN-SYSTEM §4.3).
 *
 * Every result the target app returned is prefixed `[c1]`, `[c2]`… and a finding cites the ones
 * it rests on. This is that citation, and it is recognised by **three things at once** so the
 * seam survives colour blindness, the dark flip and an 11px render: its **face** is IBM Plex
 * Mono, its **ink** is `evidence` — the one non-brand hue in the system, which is what makes it
 * read as *not us* — and its **position** is the ledger stub or the sentence it sits inside.
 *
 * `t-ref` on `evidence-wash`, `px-1 py-px`, and **square**: it names a record, and a record has
 * no radius (§5.2). It may not be a stadium, because a stadium in this system means a cohort.
 *
 * **The border is `rule-strong`, not `evidence/30`.** §4.3 originally specified the alpha and
 * ATOMIC-INVENTORY §0.2 bans it — *"no `/30` alpha"* — and the ban is the one that is right: an
 * alpha border is a fourth, invented value of a hue that already has two tokens, it composites
 * differently over `evidence-wash` than over the `sunk` well a ref sits in inside a stub, and it
 * is the first thing to disappear at 11px on a low-contrast display. `rule-strong` is the token
 * for *an interactive boundary* (§4.1) and that is exactly what this is. Nothing is lost: the ink
 * and the face carry the whole meaning, and the border is the faintest thing on the row by
 * design. §4.3 has been amended to say so.
 *
 * **`current` is a selection, not a state.** Rule 4's "no colour-alone state" governs severity,
 * verdicts, run statuses and error payloads — things that are *true about a record*. Which call
 * ref you happen to be looking at is not one of those, so it is drawn by strengthening the
 * border to the opaque token and announced properly with `aria-pressed`, which is where a
 * selection belongs.
 *
 * **The prop is `callRef`, not `ref`.** The inventory's original signature spelled it `ref`,
 * which is the runner's own word for the thing and reads beautifully at the call site — and is
 * React's one reserved prop name. Under React 19 a function component may take a prop called
 * `ref` and nothing breaks, so it worked; what it cost was the house rule. `CallRef` was the only
 * component in the system that could not be a `forwardRef`, because its own prop occupied the
 * name the DOM handle needs, and the day anything wrapped it — a `Tooltip`, a `Slot`, a
 * measurement in a transcript that wants to scroll a ref into view — the collision would have
 * surfaced as a ref that silently went nowhere. The prop is `callRef`, the ref is a ref, and
 * ATOMIC-INVENTORY §2's signature has been amended to match.
 */

const callRefChip = cva(
  [
    "inline-flex items-center align-baseline",
    "rounded-none border px-1 py-px",
    "bg-evidence-wash",
    pressTransition,
  ].join(" "),
  {
    variants: {
      /** The one you are looking at takes the border at full strength. */
      current: {
        true: "border-evidence",
        false: "border-rule-strong",
      },
      interactive: {
        true: `cursor-pointer hover:border-evidence ${focusRing}`,
        false: "",
      },
    },
    defaultVariants: { current: false, interactive: false },
  },
);

export interface CallRefProps {
  /** The call's own name, as the runner wrote it — `c3`. Printed verbatim. */
  callRef: string;
  /** Present when the ref selects a step in the transcript beside it. */
  onSelect?: () => void;
  /** True when this ref is the step currently shown. */
  current?: boolean;
}

export const CallRef = forwardRef<HTMLElement, CallRefProps>(function CallRef(
  { callRef, onSelect, current = false },
  ref,
) {
  // "c3" alone is cryptic read aloud, so the pill names what it is. The word is hidden rather
  // than printed because the seam — mono, blue, in the stub — already says it to the eye.
  const body = (
    <>
      <VisuallyHidden>evidence call</VisuallyHidden>
      <Mono size="ref">{callRef}</Mono>
    </>
  );

  /**
   * A callback ref, because the outer node is a `<span>` or a `<button>` depending on whether
   * the ref is selectable. `RefObject` is invariant in its element type and could not be handed
   * to both; a callback taking `HTMLElement` satisfies either — the same shape `LedgerRow` uses
   * for the same reason.
   */
  const setRef = (node: HTMLElement | null): void => {
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  if (onSelect === undefined) {
    return (
      <span ref={setRef} className={cn(callRefChip({ current, interactive: false }))}>
        {body}
        {current ? <VisuallyHidden>, shown</VisuallyHidden> : null}
      </span>
    );
  }

  return (
    <button
      ref={setRef}
      type="button"
      onClick={onSelect}
      aria-pressed={current}
      className={cn(callRefChip({ current, interactive: true }))}
    >
      {body}
    </button>
  );
});
