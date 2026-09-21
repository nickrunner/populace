import { Fragment, forwardRef, type ReactNode } from "react";

import { cn } from "../../cn.js";
import { Inline, Measure, Separator, Stack, Text } from "../../atoms/index.js";
import { NameWithRole } from "../../molecules/index.js";
import { Dot } from "../Dot.js";
import { Ring } from "../Ring.js";
import { DiagramFigure, type DiagramDetail, type DiagramSize } from "./Figure.js";

/**
 * PersonDiagram — one person, across executions, in both modes (ADR-0030, ADR-0031).
 *
 * The thing this figure has to make land is that **ephemeral versus longitudinal is about
 * history and termination, not about determinism**. It is the single most misread pair of words
 * in the product, and the misreading is expensive: a reader who thinks "ephemeral" means
 * "throwaway" and "longitudinal" means "repeatable" has understood neither. So the figure draws
 * the one thing that actually differs — **what a person starts an execution holding** — and
 * draws it twice, side by side, with the same person in both.
 *
 * **The mechanism is in the line and in the words, never in colour alone** (§1.3 rule 4). In
 * longitudinal a solid rule runs between one execution and the next and the word under it is
 * *carries*; in ephemeral there is **no rule at all** and the word is *clean slate*. The absence
 * of the line is the information — the same move `Compare` makes when a row of rings sits under
 * a row of filled dots — and the word is there so the reading survives a greyscale print, a 1px
 * hairline on a bad LCD and a screen reader.
 *
 * **What a person carries is drawn in the mark's own grammar** (§8.6): a filled circle is a
 * thing they have, a ring is a thing they do not. Memory and the account are the two that matter
 * — they are what `--continue-from` seeds a run with, and what a clean slate does not.
 *
 * **The person is durable; the outcome is not.** ADR-0031's rule is that a person's name and
 * detail line are written once and never silently overwritten, so the same individual really
 * does appear in every execution. That is the *only* sameness this figure claims. Outcomes vary
 * between executions by design (ADR-0028/0030) and the caption says so in as many words, because
 * a tidy row of three identical circles is precisely the picture a reader would otherwise take
 * "same person, same result" from.
 *
 * Phone width: the filmstrip is a column below `--breakpoint-md` and a row above it, and the
 * connector turns with it — a vertical tick between stacked executions, a horizontal rule
 * between side-by-side ones. Nothing is truncated and nothing scrolls; the figure just gets
 * taller.
 *
 * **Two axes, never one.** `size` is how much room the figure has; `detail` is how much of itself
 * it draws. Both are the folder's own unions, from `Figure.js`, and it is set in the folder's one
 * frame — `DiagramFigure` — rather than in a `<figure>` of its own.
 */

/** Which of the two the figure is drawing. `both` is the comparison, and is the point. */
export type PersonDiagramMode = "both" | "ephemeral" | "longitudinal";

/** The two things an execution either hands a person or does not. */
const CARRIED = ["memory", "account"] as const;

/** A thing this person starts the execution holding, or visibly does not. */
function Carried({ item, held }: { item: string; held: boolean }): ReactNode {
  return (
    <Inline gap={2} align="center">
      {held ? <Dot state="present" size="sm" /> : <Ring size="sm" />}
      <Text size="meta" tone={held ? "ink" : "muted"}>
        {held ? item : `no ${item}`}
      </Text>
    </Inline>
  );
}

/**
 * What happens between two executions, drawn and named.
 *
 * `carries` true draws a solid `rule-strong` rule — a meaningful non-text mark owes 3:1 (§6), so
 * it is not the `rule` hairline `Separator` defaults to. `carries` false draws a box of the same
 * size with nothing in it, which keeps the two filmstrips in step column for column so a reader
 * can compare them by looking straight across.
 */
function Carry({ carries }: { carries: boolean }): ReactNode {
  const span = "h-6 w-px shrink-0 md:h-px md:w-10";
  return (
    <div className="flex shrink-0 flex-row items-center gap-2 self-center md:flex-col md:gap-1">
      {carries ? (
        <Separator className={cn(span, "bg-rule-strong")} />
      ) : (
        <span aria-hidden="true" className={cn("block", span)} />
      )}
      <Text size="meta" tone="muted">
        {carries ? "carries" : "clean slate"}
      </Text>
    </div>
  );
}

/** One execution: the person, its number, and what they walked in with. */
function Execution({
  name,
  seq,
  holding,
}: {
  name: string;
  seq: number;
  holding: boolean;
}): ReactNode {
  return (
    <Stack gap={2} align="start" className="shrink-0">
      <Dot state="present" size="lg" label={`${name}, in execution ${seq}`} />
      <Text size="meta" tone="muted">{`execution ${seq}`}</Text>
      <Stack gap={1} align="start">
        {CARRIED.map((item) => (
          <Carried key={item} item={item} held={holding} />
        ))}
      </Stack>
    </Stack>
  );
}

const MODE_COPY: Record<
  "ephemeral" | "longitudinal",
  { label: string; sentence: string; carries: boolean }
> = {
  longitudinal: {
    label: "Longitudinal — history accumulates",
    sentence:
      "Memory, the account and the visit count carry over, so the same person arrives knowing what happened last time. Pausable, and unbounded until you stop it.",
    carries: true,
  },
  ephemeral: {
    label: "Ephemeral — a clean slate",
    sentence:
      "Nothing is carried. Every person gets the same fixed number of visits, and then the simulation ends.",
    carries: false,
  },
};

/** One mode's filmstrip, with its label, its rule and its sentence. */
function ModeBand({
  mode,
  name,
  executions,
  withSentence,
}: {
  mode: "ephemeral" | "longitudinal";
  name: string;
  executions: number;
  withSentence: boolean;
}): ReactNode {
  const copy = MODE_COPY[mode];
  const seqs = Array.from({ length: executions }, (_, i) => i + 1);

  return (
    <Stack gap={3}>
      <Stack gap={2}>
        <Text size="eyebrow" tone="muted">
          {copy.label}
        </Text>
        <Separator />
      </Stack>

      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
        {seqs.map((seq) => (
          <Fragment key={seq}>
            {seq === 1 ? null : <Carry carries={copy.carries} />}
            {/* Nobody walks into the first execution holding anything, in either mode — which is
                why the two strips are identical at execution 1 and diverge from execution 2. */}
            <Execution name={name} seq={seq} holding={copy.carries && seq > 1} />
          </Fragment>
        ))}
      </div>

      {withSentence ? (
        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            {copy.sentence}
          </Text>
        </Measure>
      ) : null}
    </Stack>
  );
}

export interface PersonDiagramProps {
  /** The person's stored name. Defaults to a sample, so the figure stands on its own. */
  name?: string;
  /**
   * Their detail line — the one sentence that says who they are.
   *
   * It is `line` rather than `detail` because `detail` is the folder's word for *how much of
   * itself a figure draws*, and one word cannot be both a person's biography and a rendering
   * axis.
   */
  line?: string;
  /** The cohort they belong to, named as a word rather than a slug (§7.4). */
  cohort?: string;
  /** `both` is the comparison the figure exists for. Default `both`. */
  mode?: PersonDiagramMode;
  /**
   * How many executions to draw. Two is the fewest that shows the difference; four is plenty.
   *
   * It is `executionCount` rather than `executions` because `executions` is already the folder's
   * word for *which two execution numbers a figure is comparing* — `VarianceDiagram` and
   * `AbsenceDiagram` both take it as a `[number, number]`. One word cannot be a pair of labels in
   * two figures and a length in a third.
   */
  executionCount?: number;
  /** How much room the figure has. */
  size?: DiagramSize;
  /** `full` draws the detail line and each mode's sentence; `compact` draws the strips alone. */
  detail?: DiagramDetail;
  id?: string;
  className?: string;
}

const SAMPLE_NAME = "Maya Okonjo";
const SAMPLE_DETAIL =
  "Signed up on a phone, on a train, with nine minutes to spare — and came back on Thursday to finish.";
const SAMPLE_COHORT = "Early adopters";

/**
 * The figure's own caption. **There is no `caption` prop, and that is §7.3 rather than an
 * oversight.** Every figure in this folder ends on the clause that keeps it honest — outcomes
 * vary between executions by design, and a problem that stops appearing is an absence rather
 * than a repair — and a prop that replaces the caption is a prop that deletes the clause. The
 * six mechanism and honesty figures never had one; these three did, and they do not now. A page
 * that wants to say more says it in its own prose beside the figure.
 */
const DEFAULT_CAPTION =
  "The individual is the same in every execution — the name and the detail line are written once and never silently overwritten. What that person does is not: outcomes vary between executions by design, so a problem missing from the newest execution is an absence, not a repair.";

export const PersonDiagram = forwardRef<HTMLElement, PersonDiagramProps>(function PersonDiagram(
  {
    name = SAMPLE_NAME,
    line = SAMPLE_DETAIL,
    cohort = SAMPLE_COHORT,
    mode = "both",
    executionCount = 3,
    size = "panel",
    detail = "full",
    id,
    className,
  },
  ref,
) {
  const count = Math.min(4, Math.max(2, Math.round(executionCount)));
  const modes: readonly ("ephemeral" | "longitudinal")[] =
    mode === "both" ? ["longitudinal", "ephemeral"] : [mode];

  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={className}
      sample={name === SAMPLE_NAME}
      name="One person, across executions"
      lede="Ephemeral and longitudinal differ in exactly one thing: what a person walks in holding. It is about history and termination, and never about repeating a result."
      trailing={`${count} executions`}
      caption={DEFAULT_CAPTION}
    >
      <Stack gap={8}>
        <Stack gap={2}>
          <NameWithRole name={name} role={cohort} />
          {detail === "full" ? (
            <Measure width="read">
              <Text as="p" size="read" tone="soft">
                {line}
              </Text>
            </Measure>
          ) : null}
        </Stack>

        {modes.map((one) => (
          <ModeBand
            key={one}
            mode={one}
            name={name}
            executions={count}
            withSentence={detail === "full"}
          />
        ))}
      </Stack>
    </DiagramFigure>
  );
});
