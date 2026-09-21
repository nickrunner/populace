import { forwardRef, useId } from "react";

import { IconButton, Input, Label, VisuallyHidden } from "../atoms/index.js";

/**
 * SearchInput — ATOMIC-INVENTORY §2 molecule 10. New; three sites (the findings list, the tool
 * table, the project switcher).
 *
 * The inventory gives this one a file, a layer and a site count but **no props signature**, so
 * the shape below is derived from the two rules that do apply to it.
 *
 * **It is labelled.** DESIGN-SYSTEM §6: "an instrument is labelled", and the only glyph allowed
 * to stand alone is an `IconButton`'s. A filter over a list is a control whose caption would be
 * noise repeated above every list on every screen, so the caption is a real `Label` with a real
 * `htmlFor`, rendered inside `VisuallyHidden` — present to a screen reader, absent from the
 * layout. `label` is therefore required, and it defaults the placeholder, so the visible prompt
 * and the spoken name are one string and cannot drift.
 *
 * **There is no magnifying glass**, because the system has eight utility glyphs and no search
 * among them, and §8.6's icon policy is that a missing glyph means the label was supposed to be
 * prose. The placeholder is the affordance.
 *
 * The clear button appears only when there is something to clear, and Escape does the same thing
 * from the keyboard — the handler sits on the wrapper because keyboard events bubble, and
 * `Input`'s signature is deliberately closed. Right padding is held whether or not the button is
 * showing, so the text never jumps sideways on the first keystroke.
 */
export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  /** The accessible name, e.g. "Search findings". Also the default placeholder. */
  label: string;
  placeholder?: string;
  id?: string;
}

export const SearchInput = forwardRef<HTMLDivElement, SearchInputProps>(function SearchInput(
  { value, onChange, label, placeholder, id },
  ref,
) {
  const generated = useId();
  const controlId = id ?? `search-${generated}`;
  const filled = value !== "";

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && filled) {
          event.stopPropagation();
          onChange("");
        }
      }}
    >
      <VisuallyHidden>
        <Label htmlFor={controlId}>{label}</Label>
      </VisuallyHidden>
      <Input
        id={controlId}
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? label}
        autoComplete="off"
        className="pr-8"
      />
      {filled ? (
        <IconButton
          icon="x"
          label="Clear the search"
          size="sm"
          onClick={() => {
            onChange("");
          }}
          className="absolute inset-y-0 right-1 my-auto"
        />
      ) : null}
    </div>
  );
});
