import { forwardRef, useState } from "react";

import { Input, TextArea } from "../atoms/index.js";
import { Field } from "./Field.js";

/**
 * TagListField — ATOMIC-INVENTORY §2 molecule 7. The one implementation of `asList()`, which the
 * target editor and the persona editor currently carry as two verbatim copies of the same six
 * lines.
 *
 * Tool globs, allow lists, deny lists, trait names: a `string[]` the reader edits as text.
 *
 * **It is forgiving on the way in and consistent on the way out.** A reader pasting a list will
 * paste it with whatever separator they had, so both commas and newlines always split, whichever
 * `separator` is set; `separator` decides only how the field *joins the array back* and which
 * control is drawn — one line for a comma list, four for a newline list.
 *
 * **The typed text is buffered.** Deriving the field's contents from `value.join(", ")` on every
 * render would delete the separator the instant it was typed — `a,` parses to `["a"]`, joins
 * back to `"a"`, and the comma disappears under the cursor. So the draft is local, and it is
 * re-synced only when a value arrives from *outside* that the draft does not already parse to.
 * This is `NumberInput`'s adjust-during-render pattern, which is the sanctioned way to derive
 * state from a prop, applied to a list instead of a figure.
 *
 * Both controls stay in Space Grotesk. A glob is a pattern the reader writes, not something the
 * target app emitted, so §4.3's evidence seam does not reach it — and `TextArea` has no `mono`
 * of its own, so a field whose family flipped with its separator would be the only control in
 * the product that changed face depending on how it was configured.
 */

/** Both separators always split. Empty entries are dropped; every entry is trimmed. */
export function parseTagList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export interface TagListFieldProps {
  value: readonly string[];
  onChange: (v: string[]) => void;
  label: string;
  hint?: string;
  /** How the list is joined back, and therefore whether it is one line or four. */
  separator?: "comma" | "newline";
  placeholder?: string;
}

export const TagListField = forwardRef<HTMLDivElement, TagListFieldProps>(function TagListField(
  { value, onChange, label, hint, separator = "comma", placeholder },
  ref,
) {
  const join = (entries: readonly string[]): string =>
    entries.join(separator === "newline" ? "\n" : ", ");

  // A list has no identity of its own across renders, so the comparison is on contents. NUL is
  // the one character a glob or a trait name cannot contain, which makes the join unambiguous.
  const canonical = value.join("\u0000");
  const [draft, setDraft] = useState(() => join(value));
  const [lastCanonical, setLastCanonical] = useState(canonical);

  if (canonical !== lastCanonical) {
    setLastCanonical(canonical);
    // Only when the incoming value is not what this field already says: that is what tells an
    // edit made elsewhere apart from the echo of the reader's own keystroke.
    if (parseTagList(draft).join("\u0000") !== canonical) setDraft(join(value));
  }

  const commit = (next: string): void => {
    setDraft(next);
    onChange(parseTagList(next));
  };

  return (
    <Field ref={ref} label={label} hint={hint}>
      {({ id, describedBy, invalid }) =>
        separator === "newline" ? (
          <TextArea
            id={id}
            describedBy={describedBy}
            invalid={invalid}
            value={draft}
            onChange={commit}
            placeholder={placeholder}
            rows={4}
          />
        ) : (
          <Input
            id={id}
            describedBy={describedBy}
            invalid={invalid}
            value={draft}
            onChange={commit}
            placeholder={placeholder}
          />
        )
      }
    </Field>
  );
});
