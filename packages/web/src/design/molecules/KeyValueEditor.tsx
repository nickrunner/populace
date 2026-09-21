import { useId, useState, type ReactNode } from "react";

import { Button, IconButton, Inline, Input, Mono, Spacer, Stack, Text } from "../atoms/index.js";
import { Field } from "./Field.js";

/**
 * KeyValueEditor — a record whose keys the reader invents, and the value beside each one.
 *
 * ATOMIC-INVENTORY §5 page 11 names it on `PersonaEditor`, where the traits a persona is told
 * apart by are exactly that: a set of names this product happens to need, each with either a
 * fixed value or a spec that draws one per person. It is a layout and an add/remove rule; what a
 * value IS stays the caller's, because only the caller knows whether a value is editable text or
 * a sentence describing a draw.
 *
 * **A key is machine speech and it is set as such** (§4.3): `Mono`, in the evidence ink, in a
 * fixed column so a column of keys is scannable. The key is also what names the row's remove
 * control, so a screen reader hears *"Remove device"* rather than one of eleven *Remove*s.
 *
 * **Adding is two controls and a rule**: a name, and a button that is at a bound until the name
 * is something. The new key arrives with whatever empty value the caller's `onAdd` decides —
 * nothing here invents a value for it.
 */

export interface KeyValueRow {
  /** The key, verbatim. Also the React key and the name in the remove control. */
  key: string;
  /** The value: a control the caller rendered, or a sentence about how the value is drawn. */
  value: ReactNode;
}

export interface KeyValueEditorProps {
  rows: readonly KeyValueRow[];
  /** What the reader is adding, sentence case — "Add a trait". Names the input and the button. */
  addLabel: string;
  addPlaceholder?: string;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  /** The sentence for a record with nothing in it yet. */
  empty?: ReactNode;
}

export function KeyValueEditor({
  rows,
  addLabel,
  addPlaceholder,
  onAdd,
  onRemove,
  empty,
}: KeyValueEditorProps): ReactNode {
  const inputId = useId();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const taken = rows.some((row) => row.key === trimmed);

  return (
    <Stack gap={4}>
      {rows.length === 0 && empty !== undefined ? (
        <Text as="p" size="read-sm" tone="soft">
          {empty}
        </Text>
      ) : null}

      {rows.length === 0 ? null : (
        <Stack gap={2} as="ul">
          {rows.map((row) => (
            <li key={row.key}>
              <Inline gap={3} align="center">
                <Mono size="code-sm" className="w-40 shrink-0">
                  {row.key}
                </Mono>
                <div className="min-w-0 flex-1">{row.value}</div>
                <Spacer />
                <IconButton
                  icon="x"
                  label={`Remove ${row.key}`}
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    onRemove(row.key);
                  }}
                />
              </Inline>
            </li>
          ))}
        </Stack>
      )}

      <Inline gap={2} align="end">
        <div className="w-60 min-w-0">
          {/*
            A name already taken is reported by the control being at a bound and by nothing else:
            an `error` here would set `aria-invalid`, and a form's save would then move focus into
            this half-typed key rather than to whatever actually rejected the save.
          */}
          <Field label={addLabel} htmlFor={inputId}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={name}
                onChange={setName}
                placeholder={addPlaceholder}
                mono
              />
            )}
          </Field>
        </div>
        <Button
          variant="secondary"
          atBound={trimmed === "" || taken}
          onClick={() => {
            if (trimmed === "" || taken) return;
            onAdd(trimmed);
            setName("");
          }}
        >
          Add
        </Button>
      </Inline>
    </Stack>
  );
}
