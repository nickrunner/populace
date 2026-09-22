import { forwardRef, type ReactNode } from "react";
import type { ExecutionHistoryEntry, RunStatus } from "@populace/contract";

import { plural } from "../../format.js";
import type { Tone } from "../tokens.js";
import { Chip, Text, VisuallyHidden } from "../atoms/index.js";
import { MetaLine, Money, RelativeTime, type MetaFact } from "../molecules/index.js";
import { LedgerRow } from "./Ledger.js";

/**
 * ExecutionRow — one time somebody pressed go (ATOMIC-INVENTORY §3, organism 30).
 *
 * An **execution** is one execution of a simulation; the word "run" survives only in `runId` and
 * in the CLI (§7.1). The number in the stub is the one a reader recognises — *execution 3* — and
 * it is the row's locator, which is why this is a `LedgerRow`: the 72px right-aligned column, the
 * one continuous spine, the selection gutter and the collapse below `--breakpoint-md` are the
 * ledger's, not this row's, and the number is scannable down the list instead of inline (§1.2 M2).
 *
 * **The status is a word in a stadium `Chip`, never a coloured dot** (§4.2). `killed` and `failed`
 * share an ink and so do `paused` and `pending`; the word is what tells them apart, and the hue is
 * the redundant channel. `running` is the one live pill, and `Chip` owns its forest ground, its
 * lime dot and its reduced-motion substitution — this row does not spell any of that.
 *
 * **Nothing here compares this execution to another one.** Two executions genuinely disagree by
 * design (§7.3): different people do different things, so a number that moved between executions
 * is not evidence that anything about the product changed. The row reports its own numbers, and
 * `ExecutionCompare` is where two of them are put side by side with that caveat stated out loud.
 *
 * The contract has no `ExecutionSummaryView`; `ExecutionHistoryEntry` is the record this row is
 * of, and it is already in the user's words — `visits`, `findings`, `confirmed`, `costUsd`.
 */

/**
 * §4.2, stated as a map: the hue no longer has to carry the status, so four of the six share one.
 * `live` is the sanctioned lime (§5.4, appearance 2) and is the only tone here with a ground.
 */
const STATUS_TONE = {
  pending: "neutral",
  running: "live",
  paused: "neutral",
  completed: "neutral",
  killed: "bad",
  failed: "bad",
} satisfies Record<RunStatus, Tone>;

export interface ExecutionRowProps {
  execution: ExecutionHistoryEntry;
  /** This is the execution being read. Takes the selection ground and `aria-current`. */
  current: boolean;
  /**
   * Where the row goes, when it goes anywhere. **Optional, and the omission is meaningful**: the
   * only destination an execution has is itself beside another one, and the oldest execution in a
   * history has nothing before it to be put beside. A row with no comparison to offer is a row
   * with nothing to open, and `LedgerRow` renders it as a plain row rather than as a link to
   * somewhere a reader did not ask to go.
   */
  to?: string;
  /**
   * A control that acts on this execution rather than opening it — in practice, deleting it.
   * It goes to `LedgerRow`'s `aside`, which renders outside the row's link, because a button
   * inside an anchor is a control that navigates instead of doing what it says.
   */
  aside?: ReactNode;
}

export const ExecutionRow = forwardRef<HTMLElement, ExecutionRowProps>(
  function ExecutionRow({ execution, current, to, aside }, ref) {
    const facts: readonly MetaFact[] = [
      { key: "visits", node: plural(execution.visits, "visit") },
      { key: "findings", node: plural(execution.findings, "finding") },
      { key: "confirmed", node: `${execution.confirmed} confirmed` },
      { key: "cost", node: <Money usd={execution.costUsd} /> },
    ];

    return (
      <LedgerRow
        ref={ref}
        {...(to === undefined ? {} : { to })}
        {...(aside === undefined ? {} : { aside })}
        selected={current}
        density="tight"
        /**
         * A locator and nothing else, and `Ledger` sets it: an execution number is "an integer
         * position in this list", so it takes the one step §3.4 gives the stub's sequence.
         *
         * It was `t-figure-sm` here — 18px of sans, which says *measurement* — on the reasoning
         * that the number is ours rather than the machine's (§3.1). That reasoning is real and
         * it is overruled for this column by name: §3.4 assigns `t-ref` to "the stub's 4-digit
         * sequence" and M2 calls the stub's locator "the 4-digit mono sequence", because a
         * position has to line up with the `[c3]` refs and the severity stacks sharing the
         * column, not with the figures in the row beside it.
         *
         * `stubKind` is explicit because the unit travels with the number for a screen reader,
         * which makes this a wrapped position rather than a bare one — the one thing the
         * bare-value rule cannot see.
         */
        stubKind="position"
        stub={
          <>
            <VisuallyHidden>execution </VisuallyHidden>
            {execution.seq}
          </>
        }
      >
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Chip tone={STATUS_TONE[execution.status]}>{execution.status}</Chip>
            {execution.label === "" ? null : (
              <Text size="ui" tone="ink" truncate>
                {execution.label}
              </Text>
            )}
            <Text size="meta" tone="muted">
              {execution.startedAt === null ? (
                "never started"
              ) : (
                <RelativeTime at={execution.startedAt} mode="absolute" />
              )}
            </Text>
          </div>

          <MetaLine facts={facts} />
        </div>
      </LedgerRow>
    );
  },
);
