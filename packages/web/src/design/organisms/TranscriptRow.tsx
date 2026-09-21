import { memo } from "react";
import type { ReactElement } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { rowBase } from "../variants.js";
import type { SeverityLevel } from "../tokens.js";
import { Badge, Mono, Text } from "../atoms/index.js";
import { CallRef, SeverityStack, ToolName } from "../molecules/index.js";

/**
 * TranscriptRow — one step of one visit, as a row in the ledger (ATOMIC-INVENTORY §3, organism 26).
 *
 * This replaces the ten hand-written step variants the visit screen carries today, where a step's
 * kind was expressed as a colour lookup and nothing else. Three rules shape it.
 *
 * **It is a ledger row, so it is square and it has a stub** (§1.2 M2). The 72px right-aligned stub
 * carries locators and nothing else: the four-digit sequence, the `[c3]` call ref, and the
 * severity stack when the step filed something. The content column carries the sentence-free
 * chrome — title, sub-line, measurement — and the list draws the one continuous spine between
 * them. Below `--breakpoint-md` the stub collapses and its contents become a leading line, which
 * is why the stub is a flex row that turns into a right-aligned column at `md`.
 *
 * **It is all sans** (§3.1, exception 2). A 200-row transcript is scanned as it arrives, so
 * family-as-channel is worth more here than sentence-ness and nothing in this row is set in the
 * serif. The one deliberate break is a `tool.call`'s title, which is IBM Plex Mono in `evidence`
 * — the family alone then tells you which steps touched the target app, with no colour read at
 * all (§4.3). That is what `ToolName` is for and it is not re-rolled here.
 *
 * **No state is carried by colour alone** (§1.3 rule 4). A suspect step gets a 2px `critical` edge
 * on its content column *and* the word `suspect` in a `Badge`; a step that filed something gets
 * the severity stack in the stub *and* the severity word beside the title, because the stack's
 * own law is that the word always accompanies it (§1.2 M3).
 *
 * **It is a listbox option, not a button.** The list is one roving-tabindex composite with a
 * single tab stop (§6), so the row takes no `tabIndex` of its own and wears no focus ring: the
 * ring belongs to the list, and `aria-selected` is what a reader is told. It is memoised on its
 * props so a two-second poll cannot re-render two hundred rows under the reader, and it draws no
 * enter animation, because an animated row in a re-fetched list is a strobe (§5.1).
 */

/** The kinds a step can be, in the user's words. No internal row name reaches this union. */
export type TranscriptKind =
  | "visit.start"
  | "memory"
  | "model.turn"
  | "tool.call"
  | "reporter.call"
  | "guardrail"
  | "identity"
  | "finding"
  | "note"
  | "visit.end";

export interface TranscriptStep {
  id: string;
  seq: number;
  kind: TranscriptKind;
  title: string;
  sub?: string;
  meta?: string;
  callRef?: string;
  suspect?: boolean;
  severity?: SeverityLevel;
}

export interface TranscriptRowProps extends TranscriptStep {
  selected: boolean;
  onSelect: () => void;
}

/**
 * The DOM id of a step's option, so the list can point `aria-activedescendant` at it and scroll
 * it into view. It is a function rather than a prop because `TranscriptRowProps` is fixed by the
 * inventory, and both ends have to agree on the same spelling.
 */
export function transcriptOptionId(stepId: string): string {
  return `transcript-step-${stepId.replace(/[^\w-]/g, "_")}`;
}

/**
 * The title's ink, by kind. Written as variants rather than as a `Record<kind, string>` lookup
 * (§0.2), and every one of them is a token: `evidence` is the machine speaking, the quieter kinds
 * take `ink-soft`, and `critical` for a suspect step wins because CVA emits it last and `cn()`
 * resolves the conflict in favour of the last one.
 *
 * **A guardrail step takes `ink`, not `high`.** §4.1 is absolute that the four severity tokens
 * mean severity and only severity, and a guardrail is not severity 3 — it is the runner speaking
 * about its own run: a ceiling reached, a tool refused by policy, a destructive call held for
 * confirmation. None of that is a report about the target app, which is what a severity grades.
 * So it takes the product's own ink and the *title* says what was stopped (§4.2: the word carries
 * it), leaving the severity arc free to mean one thing on this row — the stack in the stub, beside
 * a step that actually filed something.
 */
const stepTitle = cva("", {
  variants: {
    kind: {
      "visit.start": "text-ink",
      memory: "text-ink-soft",
      "model.turn": "text-ink",
      "tool.call": "text-evidence",
      "reporter.call": "text-ink",
      guardrail: "text-ink",
      identity: "text-ink-soft",
      finding: "text-ink",
      note: "text-ink-soft",
      "visit.end": "text-ink",
    },
    suspect: { true: "text-critical", false: "" },
  },
  defaultVariants: { kind: "note", suspect: false },
});

/**
 * The stub: a leading line below `md`, a right-aligned column at and above it. `pr-2.5` keeps its
 * contents off the spine the list draws at the column's right edge.
 */
const STUB = [
  "flex min-w-0 items-baseline gap-1.5 pl-2",
  "md:flex-col md:items-end md:gap-0.5 md:pl-0 md:pr-2.5",
].join(" ");

export const TranscriptRow = memo(function TranscriptRow({
  id,
  seq,
  kind,
  title,
  sub,
  meta,
  callRef,
  suspect = false,
  severity,
  selected,
  onSelect,
}: TranscriptRowProps): ReactElement {
  return (
    // No key handler and no tabIndex here on purpose: the list is the composite, and it owns the
    // single tab stop, the arrow keys and Enter (§6). An option that handled its own keys would
    // be a second tab stop, and there are two hundred of them.
    <li
      id={transcriptOptionId(id)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        rowBase({ density: "tight", interactive: true, selected }),
        // The 3px selected edge is RESERVED on every row, so selecting one does not shift its
        // contents 3px sideways in a two-hundred-row list. The list's spine is offset by the same
        // 3px, which is what keeps the stub column and the rule on top of each other.
        "grid grid-cols-1 border-l-[3px]",
        selected ? "" : "border-l-transparent",
        "md:grid-cols-[var(--w-stub)_minmax(0,1fr)]",
      )}
    >
      <span className={STUB}>
        <Mono size="ref" tone="muted">
          {String(seq).padStart(4, "0")}
        </Mono>
        {callRef === undefined ? null : <CallRef callRef={callRef} current={selected} />}
        {severity === undefined ? null : <SeverityStack level={severity} />}
      </span>

      <span
        className={cn(
          "min-w-0 pl-2 pr-2 md:pl-3",
          suspect ? "border-l-2 border-l-critical md:pl-2.5" : "",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {kind === "tool.call" ? (
            <ToolName name={title} />
          ) : (
            <Text size="ui" truncate className={cn("min-w-0", stepTitle({ kind, suspect }))}>
              {title}
            </Text>
          )}
          {severity === undefined ? null : (
            <Badge variant="severity" tone={severity}>
              {severity}
            </Badge>
          )}
          {suspect ? <Badge variant="bad">suspect</Badge> : null}
          {meta === undefined || meta === "" ? null : (
            <Text size="meta" tone="muted" className="ml-auto shrink-0">
              {meta}
            </Text>
          )}
        </span>

        {sub === undefined || sub === "" ? null : kind === "tool.call" ? (
          <Mono size="code-sm" tone="muted" className="mt-0.5 block truncate">
            {sub}
          </Mono>
        ) : (
          <Text size="meta" tone="muted" truncate as="span" className="mt-0.5 block">
            {sub}
          </Text>
        )}
      </span>
    </li>
  );
});
