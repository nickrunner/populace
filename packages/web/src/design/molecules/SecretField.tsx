import { forwardRef, useState } from "react";

import { Button, Input } from "../atoms/index.js";
import { Field } from "./Field.js";

/**
 * SecretField — ATOMIC-INVENTORY §2 molecule 5. Replaces the hand-rolled password input and its
 * "stored" hint (3 sites: an API key, a bearer token, a header value).
 *
 * **Blank means keep, and the placeholder says so.** A stored secret is never sent to the
 * browser, so `value` arrives empty and the field must not read as "we lost your key". The
 * placeholder carries the whole contract in one line, which is why the inventory puts it there
 * rather than in the hint: the hint slot stays the caller's, for whatever the key is *for*.
 *
 * **It never echoes the secret in plain text by default.** The control is `type="password"`
 * until the reader asks otherwise, and the ask is only offered for text they typed in this
 * session: when `value` is empty there is nothing in the DOM to reveal, so a secret that is
 * merely *stored* can never be unmasked here at all. That is the property that matters — the
 * reveal is a proofreading aid for a key being pasted, not a way to read a key back out.
 *
 * The reveal is a **word**, not a glyph. The system has eight utility glyphs and no eye among
 * them, and §8.6's icon policy is that a missing glyph is the signal that the label was supposed
 * to be prose. `aria-pressed` makes it a toggle rather than two buttons that happen to swap
 * captions.
 *
 * The step is `t-code`: a key is a string the machine is named by, and §4.3 gives those IBM Plex
 * Mono always — which is also what makes a mistyped character findable in a 64-character token.
 */
export interface SecretFieldProps {
  /** Whether a value is already held server-side. Decides the placeholder, not the value. */
  stored: boolean;
  value: string;
  onChange: (v: string) => void;
  label: string;
  hint?: string;
}

export const SecretField = forwardRef<HTMLDivElement, SecretFieldProps>(function SecretField(
  { stored, value, onChange, label, hint },
  ref,
) {
  const [revealed, setRevealed] = useState(false);
  const typed = value !== "";
  // Nothing typed, nothing to reveal — so a stored-but-untouched secret has no unmasked state
  // to get into, whatever the toggle last remembered.
  const showing = revealed && typed;

  return (
    <Field ref={ref} label={label} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <Input
            id={id}
            describedBy={describedBy}
            invalid={invalid}
            type={showing ? "text" : "password"}
            value={value}
            onChange={onChange}
            mono
            autoComplete="off"
            placeholder={stored ? "Stored — leave this blank to keep it" : undefined}
            // Room for the reveal toggle, held whether or not it is showing, so the text does
            // not jump sideways on the first keystroke.
            className="pr-16"
          />
          {typed ? (
            <Button
              variant="quiet"
              size="sm"
              aria-pressed={revealed}
              onClick={() => {
                setRevealed(!revealed);
              }}
              className="absolute inset-y-0 right-1 my-auto"
            >
              {showing ? "Hide" : "Show"}
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  );
});
