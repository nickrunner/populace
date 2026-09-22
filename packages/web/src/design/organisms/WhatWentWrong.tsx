import { forwardRef, type ReactNode } from "react";

import { Stack } from "../atoms/index.js";
import { FieldError } from "../molecules/index.js";
import { PayloadBlock } from "./PayloadBlock.js";

/**
 * WhatWentWrong — a mutation that did not land, in the product's voice, with the machine's own
 * words quoted beneath it.
 *
 * DESIGN-SYSTEM §7.4: *"Errors say what failed and what to do, with the machine's own words
 * quoted in a mono well beneath, never paraphrased into prose."* That is two components and one
 * rule, and it was being spelled two ways — five screens composed a `FieldError` over a
 * `PayloadBlock` through a local helper of this name, and four others dumped a raw
 * `error.message` straight into a `FieldError`, which puts an HTTP status and a server's
 * punctuation into the product's own sentence and loses the evidence seam entirely (§4.3).
 *
 * The split is the point. `says` is **ours**: what failed, in the reader's terms, and what is
 * still true — *"No cohort was added."*, *"Nothing changed. The cohorts above are as they were."*
 * It is `role="alert"`, so it is spoken the moment it appears. The well is **theirs**: verbatim,
 * pretty-printed, never truncated, in the evidence face and ink, with a `Copy` control, because
 * the string a reader needs to paste into an issue is the one the machine produced.
 *
 * **`id` is optional, and that is deliberate.** The id exists to be pointed at: the control whose
 * press failed names it in `aria-describedby`, which is what attaches the message to the act
 * rather than leaving it sitting near it. Where no single control owns the failure — a row
 * action that any of twelve rows could have fired — there is nothing to point at, and minting an
 * id that nothing references is worse than none: it reads as wiring in the source and is wiring
 * nowhere. The `role="alert"` is the whole announcement in that case, which is what it is for.
 */
export interface WhatWentWrongProps {
  /** What failed and what is still true, in the product's voice. Never the machine's words. */
  says: string;
  /** The failure. Its message is quoted verbatim in the well. */
  error: Error;
  /** The id the control that failed names in `aria-describedby`, where one owns the failure. */
  id?: string;
  /**
   * The way past this particular failure, where there is one — a retry that takes a different
   * route, or the act the refusal was asking for. It sits UNDER the machine's words rather than
   * over them, because a reader offered a button before they have read what refused them has
   * been handed a way to repeat their mistake faster.
   *
   * Most failures have no such thing and leave this out. A generic "Try again" belongs to
   * `StateBlock`, which is the failed READ; this is the failed WRITE, and the only button worth
   * putting here is one that does something different from what just failed.
   */
  children?: ReactNode;
}

export const WhatWentWrong = forwardRef<HTMLDivElement, WhatWentWrongProps>(
  function WhatWentWrong({ says, error, id, children }, ref) {
    return (
      <Stack ref={ref} gap={2} align="start">
        <FieldError id={id}>{says}</FieldError>
        <PayloadBlock caption="What came back" value={error.message} error />
        {children}
      </Stack>
    );
  },
);
