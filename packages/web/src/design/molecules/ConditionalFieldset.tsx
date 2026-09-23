import { useState, type ReactNode } from "react";

import { Measure, Radio, RadioGroup, Stack, Text } from "../atoms/index.js";
import { Disclosure } from "./Disclosure.js";

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
  /**
   * This branch cannot be chosen, and why — in the reader's words, as the radio's hint.
   *
   * DESIGN-SYSTEM §6: a control at a bound is inert, not gone. A branch the check has just told
   * the reader is impossible ("nothing on this server looks like a sign-up") must still be
   * visible with its reason attached, or the sentence and the missing option are two facts the
   * reader has to join up themselves. The press is swallowed here rather than by the radio,
   * because the value belongs to the group.
   */
  disabled?: { reason: string };
}

export interface ConditionalFieldsetProps<T extends string> {
  /** The question, sentence case: "Way in". */
  legend: string;
  /** The radio group's form name. */
  name: string;
  value: T;
  onChange: (v: T) => void;
  branches: readonly ConditionalBranch<T>[];
  /**
   * The branches that are escape hatches rather than answers, behind a disclosure.
   *
   * Four options with four hints assert that these are four comparable choices a reader should
   * weigh, and where they are not — where two of them exist for somebody who cannot change the
   * app at all — that assertion is the thing that makes the question unanswerable. They are a
   * second list and not a flag on the first because the fold is a piece of layout the group owns,
   * and a caller reordering `branches` must not be able to interleave them.
   *
   * It opens by itself when the chosen value is one of them: a reader editing a target that
   * already uses one must never have to go looking for the setting they are looking at.
   */
  folded?: { label: string; branches: readonly ConditionalBranch<T>[] };
}

export function ConditionalFieldset<T extends string>({
  legend,
  name,
  value,
  onChange,
  branches,
  folded,
}: ConditionalFieldsetProps<T>): ReactNode {
  const all = [...branches, ...(folded?.branches ?? [])];
  const chosen = all.find((branch) => branch.value === value);
  /*
   * Open when the chosen value is folded away: a reader editing a target that already uses one of
   * these must never go looking for the setting they are looking at. Held here rather than left to
   * the disclosure because what is INSIDE the fold depends on it — see the note below.
   */
  const [open, setOpen] = useState(folded?.branches.some((branch) => branch.value === value) ?? false);

  const option = (branch: ConditionalBranch<T>): ReactNode => (
    <Radio
      key={branch.value}
      value={branch.value}
      label={branch.label}
      // The reason replaces the hint rather than joining it: a branch that cannot be chosen has
      // one thing to say about itself, and the hint describing what choosing it would mean is
      // exactly the sentence that would contradict it.
      hint={branch.disabled === undefined ? branch.hint : branch.disabled.reason}
      atBound={branch.disabled !== undefined}
    />
  );

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
          const picked = all.find((branch) => branch.value === next);
          // A branch at a bound swallows the press here, where the value lives, rather than being
          // natively disabled — which would take it and its reason out of the tab order entirely.
          if (picked !== undefined && picked.disabled === undefined) onChange(picked.value);
        }}
      >
        {branches.map(option)}
        {folded === undefined ? null : (
          /*
           * The folded radios are rendered ONLY while the fold is open, and that is not a
           * nicety. `Disclosure` force-mounts its content so the close can animate, leaving it
           * `visibility: hidden` — which takes an element out of the accessibility tree while the
           * roving-focus group around it still counts the item, so an arrow key lands on
           * something that cannot take focus and nothing happens. Rendering them late is what
           * keeps the group's items and its focusable items the same set.
           */
          <Disclosure label={folded.label} open={open} onOpenChange={setOpen}>
            <Stack gap={2}>{open ? folded.branches.map(option) : null}</Stack>
          </Disclosure>
        )}
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
