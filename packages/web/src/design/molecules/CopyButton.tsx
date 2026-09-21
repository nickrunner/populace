import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { IconButton, VisuallyHidden } from "../atoms/index.js";

/**
 * CopyButton — ATOMIC-INVENTORY §2, molecule 29. New; 7 sites.
 *
 * It is an `IconButton` and nothing else, which is the point: DESIGN-SYSTEM §6 allows a glyph to
 * stand without visible text in exactly one component, and only because that component always
 * carries both an `aria-label` and a `Tooltip` from one string. Copying is the archetypal case —
 * the payload well's top-right corner, the endpoint beside a target, a visit's id — and every
 * one of those places is too dense for the word "Copy" to be drawn.
 *
 * **Feedback is a word, never a colour.** §4.2's rule holds even here: on success the glyph
 * becomes a check *and* the label becomes "Copied", so the tooltip and the `aria-label` both say
 * it; a `role="status"` line announces it once for a screen reader. Nothing flashes green. After
 * a moment it returns to its resting state, because a permanent check would be a claim about the
 * clipboard's current contents that this component cannot keep true.
 *
 * **Failure says what failed.** A denied or absent clipboard — an insecure context, a browser
 * permission — is reported in the label rather than swallowed, so the reader knows to select the
 * text by hand instead of pressing a button that silently does nothing.
 */

/** How long the confirmation holds before the control returns to rest. */
const SETTLE_MS = 1600;

type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  /** The exact text put on the clipboard. */
  text: string;
  /** Names what is copied — "Copy the endpoint". Both the `aria-label` and the tooltip. */
  label?: string;
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton(
  { text, label = "Copy" },
  ref,
) {
  const [state, setState] = useState<CopyState>("idle");

  // `number` rather than `NodeJS.Timeout`: this is the DOM's `setTimeout`, and the web package
  // compiles with `"types": []`, so the Node globals are deliberately not in scope.
  const settle = useRef<number | undefined>(undefined);

  const restLater = useCallback(() => {
    if (settle.current !== undefined) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      setState("idle");
    }, SETTLE_MS);
  }, []);

  // A control unmounted mid-confirmation must not set state afterwards.
  useEffect(
    () => () => {
      if (settle.current !== undefined) window.clearTimeout(settle.current);
    },
    [],
  );

  const copy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      // No clipboard at all — an insecure origin, most often. Say so; do not pretend.
      setState("failed");
      restLater();
      return;
    }
    clipboard
      .writeText(text)
      .then(() => {
        setState("copied");
        restLater();
      })
      .catch(() => {
        setState("failed");
        restLater();
      });
  }, [text, restLater]);

  /**
   * One string feeds the glyph, the tooltip and the `aria-label`, so they cannot drift apart.
   * The resting label is the caller's own words; the two outcome labels are the component's,
   * because they describe what the control just did rather than what it acts on.
   */
  const shown =
    state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label;

  return (
    <>
      <IconButton
        ref={ref}
        // `sm` is the affordance size: this sits in the corner of a payload well or at the end
        // of a dense line, and `Button`'s coarse-pointer hit box still takes it to 44px.
        size="sm"
        icon={state === "copied" ? "check" : "copy"}
        label={shown}
        variant="quiet"
        onClick={copy}
      />
      {/*
        The outcome, announced once. A changing `aria-label` on a focused button is not reliably
        re-read, and the tooltip is not read at all on touch, so the word goes into a live region
        of its own. It is empty at rest, which is what keeps it from announcing on mount.
      */}
      <VisuallyHidden>
        <span role="status">
          {state === "copied"
            ? "Copied to the clipboard"
            : state === "failed"
              ? "Could not copy — select the text and copy it by hand"
              : ""}
        </span>
      </VisuallyHidden>
    </>
  );
});
