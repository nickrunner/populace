import { useId, type ReactNode } from "react";

import { people, plural } from "../../format.js";
import {
  IconButton,
  Inline,
  Label,
  Meter,
  NumberInput,
  Select,
  Slider,
  Spacer,
  Stack,
  Text,
  VisuallyHidden,
} from "../atoms/index.js";

/**
 * WeightedMixEditor — a ratio the reader balances by hand, with the balance drawn as they go.
 *
 * Two builders are made of this: a cohort is personas with weights, and a population is cohorts
 * with weights (ADR-0041). Neither has a headcount — the study is the only place a size lives —
 * so what the reader is setting here is **parts**, not people, and the editor's job is to make a
 * ratio legible before any size is known: 3 parts of 7 is about 43% whatever the study later
 * says 7 parts are of.
 *
 * **The `NumberInput` is the authoritative control; the `Slider` is coarse adjustment.** A weight
 * is an integer count of parts, typed exactly, and the number field is where that happens: `min`
 * 1, `step` 1, no `max`, and a value written back only as an integer. The slider is beside it
 * for the reader who wants to drag one persona up until the picture looks right; its `max` is
 * whatever the largest weight is, or 20, so a mix of ones has room to grow and a mix with a 60 in
 * it can still be dragged to 60. Both write the same integer to the same entry, so they cannot
 * disagree. **A non-integer weight already stored is shown rounded and written back only when
 * its row is touched**: an editor that silently rewrote every row on mount would mark a form
 * dirty the reader never changed.
 *
 * **The share mark is a `Meter`, never a `Capsule`.** In the mark's grammar a capsule's length
 * IS a headcount (§1.2 M4, §8.6) — that is what `CohortCapsule` draws, and it would be a lie here,
 * where nothing has a headcount yet. A meter is a proportion, which is exactly what a weight is
 * before a study gives it a size. The meter's sentence says what it is of, in parts and as a
 * percentage, so the picture is never the only place a reading exists (§4.2).
 *
 * **The percentages sum to 100.** Rounding each share on its own does not — three thirds are
 * 33 + 33 + 33 — so the column is rounded by largest remainder (`sharePercents`, exported and
 * tested): every share is floored and the leftover points go to the largest fractional parts,
 * earlier rows first on a tie. The slider's `valueLabel` and the meter's sentence use the same
 * rounded figure, so the three readings of one row agree.
 *
 * **The count is the screen's, not the editor's.** How many people a weight comes to depends on
 * a size, on the other weights and on the deal rule (`dealStudy`, in core), and this component
 * imports nothing from core by rule (ATOMIC-INVENTORY §0.2). A screen that knows a size — the
 * population builder's "Try a size", the study builder's real one — computes the counts and
 * hands them in as `previewCounts`, one per entry in entry order, with a `previewSentence` that
 * says what size they are at. Without them the editor shows parts and percentages and nothing
 * else, which is the honest reading of a ratio with no size.
 *
 * **Ties and order are stated, not accidental.** Entries are kept in the order given; the deal
 * favours earlier entries on a tie (ADR-0041), and the builders say so beside the sentence. This
 * editor never re-sorts, because a re-sort would move the tie.
 *
 * **The last one is at a bound, not gone** (§6, §7.4). Below `min` entries the remove control
 * keeps its tab stop, its name and its tooltip, wears `aria-disabled`, and its label becomes the
 * reason — `minReason` — so the control that is refusing says why. Adding is a `Select` of what
 * is not yet in the mix; when nothing is left to add it is inert and a sentence says so. When
 * there is nothing to pick from at all, the caller's `emptyState` renders in the list's place:
 * only the screen knows where the builder that would make one lives.
 *
 * Feedback is instant. `Meter` never transitions its width by rule (§5.1), `Slider` has no
 * transition, and nothing here adds one: a ratio the reader is balancing by hand has to move the
 * moment the hand does.
 */

export interface WeightedMixEntry {
  /** Stable — the React key and what the entry IS: a persona id, a cohort id. */
  id: string;
  /** The name a person typed. Never a slug (§7.4). */
  name: string;
  /** One fact beside the name — a persona's role, the first sentence of a cohort's context. */
  detail?: string;
  /** Parts, a positive integer. A stored fraction is shown rounded and written back only on touch. */
  weight: number;
}

export interface WeightedMixOption {
  id: string;
  name: string;
  detail?: string;
}

export interface WeightedMixEditorProps {
  /** The group's name, sentence case — "Mix", "Cohorts". Drawn once, above the rows. */
  legend: string;
  /** The mix, in the order the deal favours on a tie. */
  entries: readonly WeightedMixEntry[];
  /**
   * Everything that could be in the mix. Entries already present are filtered out of the add
   * control here, so a caller passes the whole list and never reconciles the two.
   */
  options: readonly WeightedMixOption[];
  /** The whole mix, after any change. The caller owns the array. */
  onChange: (entries: WeightedMixEntry[]) => void;
  /** Names the add control in the product's own words — "Add a persona", "Add a cohort". */
  addLabel: string;
  /** What renders when there is nothing to pick from: a sentence and a link to the builder. */
  emptyState: ReactNode;
  /** How many entries the mix must keep. Default 1. */
  min?: number;
  /** Why the last one cannot go. Becomes the held remove control's label. */
  minReason: string;
  /** How many people each entry comes to at some size, one per entry in entry order. */
  previewCounts?: readonly number[];
  /** What size the counts are at — "At 20 people: …". */
  previewSentence?: string;
}

/**
 * The weight as the editor shows it: a positive integer. A stored fraction, a zero or a value
 * that is not a number all read as the nearest legal part count, and nothing is written back
 * until the row is touched.
 */
export function shownWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 1;
  return Math.max(1, Math.round(weight));
}

/**
 * Whole-number percentages that sum to exactly 100, by largest remainder: floor every share,
 * then give the leftover points to the rows with the largest fractional parts, earlier rows
 * first on a tie. All zeros when nothing weighs anything, because a share of nothing is not 100%.
 */
export function sharePercents(weights: readonly number[]): number[] {
  const legal = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const total = legal.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return legal.map(() => 0);

  const exact = legal.map((weight) => (weight / total) * 100);
  const percents = exact.map((share) => Math.floor(share));
  let leftover = 100 - percents.reduce((sum, share) => sum + share, 0);

  const byRemainder = exact
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    percents[index] = (percents[index] ?? 0) + 1;
    leftover -= 1;
  }
  return percents;
}

/** The slider's floor and the number field's: one part. Nothing in a mix weighs less. */
const MIN_PARTS = 1;

/** The slider's ceiling when no weight is larger: room for a mix of ones to grow into. */
const SLIDER_ROOM = 20;

/**
 * One entry: its name and fact, the two controls that set its parts, the meter that draws its
 * share and the figures that say it.
 */
function MixRow({
  entry,
  weight,
  total,
  percent,
  sliderMax,
  count,
  atBound,
  minReason,
  onWeight,
  onRemove,
}: {
  entry: WeightedMixEntry;
  weight: number;
  total: number;
  percent: number;
  sliderMax: number;
  count: number | undefined;
  atBound: boolean;
  minReason: string;
  onWeight: (parts: number) => void;
  onRemove: () => void;
}): ReactNode {
  const nameId = useId();
  const numberId = useId();
  // The unit inflects, because a mix of one reads "1 of 1 parts" otherwise, and the one reading
  // a reader sees first is the one on the mix they have only just started building.
  const reading = `${weight} of ${plural(total, "part")}, about ${percent}%`;

  return (
    <li>
      <Stack gap={2}>
        <Inline gap={2} align="baseline" wrap>
          <Text size="name" id={nameId}>
            {entry.name}
          </Text>
          {entry.detail === undefined ? null : (
            <Text size="meta" tone="muted" truncate className="max-w-full">
              {entry.detail}
            </Text>
          )}
          <Spacer />
          {/* The column is tabular by construction — every sans step carries `tnum` (§4.4). */}
          <Text size="ui" className="shrink-0">
            {percent}%
          </Text>
          {count === undefined ? null : (
            <Text size="meta" tone="muted" className="shrink-0">
              {people(count)}
            </Text>
          )}
          <IconButton
            icon="x"
            variant="quiet"
            size="sm"
            disabled={atBound}
            label={atBound ? minReason : `Remove ${entry.name} from the mix`}
            onClick={onRemove}
          />
        </Inline>

        <Inline gap={3} align="center">
          <Inline gap={2} align="center" className="shrink-0">
            <div className="w-20">
              <NumberInput
                id={numberId}
                value={weight}
                min={MIN_PARTS}
                step={1}
                onChange={(parts) => {
                  onWeight(shownWeight(parts));
                }}
              />
            </div>
            {/*
              The visible unit is the caption; the name is spoken with it so a form with six
              number fields does not announce six controls all called "parts".
            */}
            <Label htmlFor={numberId}>
              <VisuallyHidden>{`${entry.name}: `}</VisuallyHidden>
              parts
            </Label>
          </Inline>
          <div className="min-w-0 flex-1">
            <Slider
              value={weight}
              onChange={(parts) => {
                onWeight(shownWeight(parts));
              }}
              min={MIN_PARTS}
              max={sliderMax}
              step={1}
              valueLabel={reading}
              ariaLabelledBy={nameId}
            />
          </div>
        </Inline>

        <Meter value={weight} of={total} size="sm" label={`${entry.name}: ${reading}`} />
      </Stack>
    </li>
  );
}

export function WeightedMixEditor({
  legend,
  entries,
  options,
  onChange,
  addLabel,
  emptyState,
  min = 1,
  minReason,
  previewCounts,
  previewSentence,
}: WeightedMixEditorProps): ReactNode {
  const weights = entries.map((entry) => shownWeight(entry.weight));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const percents = sharePercents(weights);
  const sliderMax = Math.max(SLIDER_ROOM, ...weights);
  const present = new Set(entries.map((entry) => entry.id));
  const remaining = options.filter((option) => !present.has(option.id));
  // At the bound only where a press would take something away: an empty mix refuses nothing.
  const atBound = entries.length <= min && entries.length > 0;

  function setWeight(index: number, parts: number): void {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, weight: parts } : entry)));
  }

  function remove(index: number): void {
    onChange(entries.filter((_, i) => i !== index));
  }

  function add(id: string): void {
    if (id === "" || present.has(id)) return;
    const option = remaining.find((candidate) => candidate.id === id);
    if (option === undefined) return;
    const entry: WeightedMixEntry = { id: option.id, name: option.name, weight: 1 };
    if (option.detail !== undefined) entry.detail = option.detail;
    onChange([...entries, entry]);
  }

  const nothingToPickFrom = entries.length === 0 && options.length === 0;

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="t-label mb-1.5 p-0 text-ink-muted">{legend}</legend>

      {nothingToPickFrom ? (
        emptyState
      ) : (
        <Stack gap={4}>
          {entries.length === 0 ? (
            <Text as="p" size="read-sm" tone="soft">
              Nothing in the mix yet.
            </Text>
          ) : (
            <Stack gap={4} as="ul">
              {entries.map((entry, index) => (
                <MixRow
                  key={entry.id}
                  entry={entry}
                  weight={weights[index] ?? MIN_PARTS}
                  total={total}
                  percent={percents[index] ?? 0}
                  sliderMax={sliderMax}
                  count={previewCounts?.[index]}
                  atBound={atBound}
                  minReason={minReason}
                  onWeight={(parts) => {
                    setWeight(index, parts);
                  }}
                  onRemove={() => {
                    remove(index);
                  }}
                />
              ))}
            </Stack>
          )}

          {previewSentence === undefined || entries.length === 0 ? null : (
            <Text as="p" size="read-sm" tone="soft">
              {previewSentence}
            </Text>
          )}

          <Inline gap={3} align="center">
            <div className="w-72 min-w-0">
              {/*
                `value=""` keeps the trigger on its placeholder, so the control is always "add
                one" and never "the last one you added". Inert, not gone, when nothing is left.
              */}
              <Select
                value=""
                onChange={add}
                options={remaining.map((option) => ({ value: option.id, label: option.name }))}
                placeholder={addLabel}
                aria-label={addLabel}
                disabled={remaining.length === 0}
              />
            </div>
            {remaining.length === 0 ? (
              <Text size="meta" tone="muted">
                Everything there is to add is in the mix.
              </Text>
            ) : null}
          </Inline>
        </Stack>
      )}
    </fieldset>
  );
}
