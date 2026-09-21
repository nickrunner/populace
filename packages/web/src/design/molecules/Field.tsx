import { forwardRef, useId, type ReactNode } from "react";

import { Label, Text } from "../atoms/index.js";
import { FieldError } from "./FieldError.js";
import { FieldWarning } from "./FieldWarning.js";

/**
 * Field — ATOMIC-INVENTORY §2 molecule 1, and the busiest molecule in the system (47 sites).
 *
 * It exists to fix one bug and to hold one contract.
 *
 * **The bug.** Today the caption and the hint are both children of a single bare `<label>`, so a
 * screen reader reads the hint as part of the control's name: *"Endpoint the URL your MCP server
 * listens on, edit text"*. DESIGN-SYSTEM §6 moves the hint **out of the `<label>` and onto
 * `aria-describedby`**, which is exactly what this molecule does — the `<label>` holds the
 * caption and nothing else, and every other message is a sibling the control *points at*.
 *
 * **The contract.** The caption is a Radix `Label` with an explicit `htmlFor` (so clicking it
 * focuses the control and a double-click does not select the paragraph around it), and the
 * control is handed everything it needs to be correct through a render prop:
 *
 * ```tsx
 * <Field label="Endpoint" hint="Where the server listens." error={problem}>
 *   {({ id, describedBy, invalid }) => (
 *     <Input id={id} describedBy={describedBy} invalid={invalid} value={url} onChange={setUrl} />
 *   )}
 * </Field>
 * ```
 *
 * A render prop rather than cloned children because the control is not always one element — a
 * `SecretField` wraps its `Input` in a positioned shell, a `DurationField` extends `describedBy`
 * with the id of its own unit suffix — and cloning cannot reach into those.
 *
 * **Message precedence.** The hint, the error and the warning all render, in that order, and
 * `aria-describedby` names them in that same order, so what is spoken matches what is seen. The
 * hint is standing guidance about how to fill the field and stays true while the field is wrong;
 * dropping it the moment an error appears takes away the instructions exactly when the reader
 * has proved they need them. The precedence that does exist is about *invalidity*, not about
 * visibility: **`error` sets `aria-invalid` and `warning` does not** — a warning is non-fatal by
 * definition (§4.2), and a control marked invalid over a note that was never blocking is a lie
 * the form tells every assistive technology reading it.
 *
 * **One family for the whole stack: sans `t-meta`** (§3.1, exception 2, as amended). The hint, the
 * error and the warning are three states of one line under one control, so they take one face,
 * and `Checkbox` and `Radio` — which carry their own hints without this molecule — take the same
 * one. A form may not show the same role in two families, which is what it did while a `Field`
 * hint was sans and a `Checkbox` hint was serif.
 *
 * **`invalid` in the render-prop bag.** The inventory's signature passes `{ id, describedBy }`
 * and separately says `error` "sets `aria-invalid` on the control" — which nothing in that bag
 * can do, since only the caller renders the control. The bag is therefore widened by one
 * boolean. It is strictly additive: every call site written against the inventory's two-key
 * destructure compiles unchanged, and the alternative — the caller passing both `error` to the
 * field and `invalid` to the control — is two sources of truth for one fact, which is the class
 * of bug this layer exists to delete.
 */
export interface FieldControlIds {
  /** The control's `id`. Generated with `useId` when the caller gives no `htmlFor`. */
  id: string;
  /** Space-separated ids of the hint, the error and the warning, in that order. */
  describedBy: string | undefined;
  /** True exactly when `error` is set. Goes on the control as `aria-invalid`. */
  invalid: boolean;
}

export interface FieldProps {
  /** The caption, sentence case. It is the control's name and nothing else lives in it. */
  label: string;
  /** Standing guidance. Announced through `aria-describedby`, never inside the `<label>`. */
  hint?: ReactNode;
  /** Blocking. Announced through `role="alert"`, and sets `aria-invalid` on the control. */
  error?: string;
  /** Non-fatal, `medium` tone. Announced, but never sets `aria-invalid`. */
  warning?: ReactNode;
  /** Marks the caption "(optional)" rather than marking every required field with an asterisk. */
  optional?: boolean;
  htmlFor?: string;
  children: (ids: FieldControlIds) => ReactNode;
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, warning, optional = false, htmlFor, children },
  ref,
) {
  const generated = useId();
  const id = htmlFor ?? `field-${generated}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;

  const described = [
    hint === undefined ? null : hintId,
    error === undefined ? null : errorId,
    warning === undefined ? null : warningId,
  ].filter((candidate): candidate is string => candidate !== null);

  return (
    // `min-w-0` so a field inside a `FieldGrid` track may shrink below the control's intrinsic
    // width instead of forcing the grid wider than the page.
    <div ref={ref} className="min-w-0">
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ml-1.5 font-normal">(optional)</span> : null}
      </Label>

      {children({
        id,
        describedBy: described.length === 0 ? undefined : described.join(" "),
        invalid: error !== undefined,
      })}

      {hint === undefined ? null : (
        <Text as="p" size="meta" tone="muted" id={hintId} className="mt-1">
          {hint}
        </Text>
      )}

      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}

      {/* The wrapper carries the id `FieldWarning`'s own signature has no prop for, so the note
          reaches `aria-describedby` without this layer inventing a prop the inventory omits. */}
      {warning === undefined ? null : (
        <div id={warningId}>
          <FieldWarning>{warning}</FieldWarning>
        </div>
      )}
    </div>
  );
});
