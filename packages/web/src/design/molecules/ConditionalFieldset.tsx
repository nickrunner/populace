import { type ReactNode } from "react";

import { Measure, Radio, RadioGroup, Stack, Text } from "../atoms/index.js";

/**
 * ConditionalFieldset — one choice, and the fields that belong to whichever way was chosen.
 *
 * ATOMIC-INVENTORY §6.3 row 23 names the pattern it replaces: *"a nested ternary returning three
 * JSX trees"*. Three trees for one decision is three places for a field to drift, three places to
 * forget a hint, and — the reason it matters here — three shapes a reader has to recognise as
 * being alternatives at all. There is one tree now: a named group of ways in, and beneath it the
 * one branch that is live.
 *
 * **The choice is a radio group, not a select.** These are branches with consequences a reader
 * needs before choosing — picking the wrong way in means every person in the execution fails at
 * the front door — and a `<select>` shows one option at a time with no room for a sentence about
 * any of them. `RadioGroup` is already a real `<fieldset>`/`<legend>`, so the fields below are
 * inside the group that chose them.
 *
 * **Only the chosen branch is mounted.** An unmounted branch's controls cannot be tabbed into,
 * cannot be submitted and cannot hold a stale `aria-invalid`, which is the behaviour the ternary
 * had and the one thing about it worth keeping.
 *
 * Generic over the caller's own union, and therefore **not** a `forwardRef`: the type parameter is
 * what keeps `onChange` narrowed to that union, and `forwardRef` erases it unless the result is
 * cast (the same departure `FilterChips` and `DataTable` make, for the same reason).
 */

export interface ConditionalBranch<T extends string> {
  value: T;
  /** The option, sentence case, in the product's own words. */
  label: string;
  /** What choosing this one means, beside the option itself. */
  hint?: ReactNode;
  /** A sentence about this way in, above its fields. Prose, serif, at the reading measure. */
  note?: ReactNode;
  /** The fields that belong to this choice. Rendered only while it is chosen. */
  fields: ReactNode;
}

export interface ConditionalFieldsetProps<T extends string> {
  /** The question, sentence case: "Way in". */
  legend: string;
  /** The radio group's form name. */
  name: string;
  value: T;
  onChange: (v: T) => void;
  branches: readonly ConditionalBranch<T>[];
}

export function ConditionalFieldset<T extends string>({
  legend,
  name,
  value,
  onChange,
  branches,
}: ConditionalFieldsetProps<T>): ReactNode {
  const chosen = branches.find((branch) => branch.value === value);

  return (
    <Stack gap={6}>
      {/*
        The picked branch carries the narrowed value, so the union survives the group's own
        `(v: string) => void` without a cast: a value that is not one of the branches is not a
        choice this fieldset offers, and nothing is reported for it.
      */}
      <RadioGroup
        legend={legend}
        name={name}
        value={value}
        onChange={(next) => {
          const picked = branches.find((branch) => branch.value === next);
          if (picked !== undefined) onChange(picked.value);
        }}
      >
        {branches.map((branch) => (
          <Radio key={branch.value} value={branch.value} label={branch.label} hint={branch.hint} />
        ))}
      </RadioGroup>

      {chosen === undefined ? null : (
        <Stack gap={4}>
          {chosen.note === undefined ? null : (
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                {chosen.note}
              </Text>
            </Measure>
          )}
          {chosen.fields}
        </Stack>
      )}
    </Stack>
  );
}
