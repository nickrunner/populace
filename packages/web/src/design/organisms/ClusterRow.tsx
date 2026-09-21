import { forwardRef } from "react";
import type { ClusterCardView, ClusterState } from "@populace/contract";

import { ago, people, plural } from "../../format.js";
import type { Density, SeverityLevel, VerdictValue } from "../tokens.js";
import { Badge, Spacer, Text, VisuallyHidden } from "../atoms/index.js";
import {
  MetaLine,
  SeverityStack,
  SeverityTag,
  ToolName,
  VerdictTag,
  type MetaFact,
} from "../molecules/index.js";
import { LedgerRow } from "./Ledger.js";

/**
 * ClusterRow — one row is one thing that is actually wrong (ATOMIC-INVENTORY §3, organism 21).
 *
 * Not one report: the same complaint from three people is a single row, which is the whole point
 * of clustering (ADR-0017). The row is keyed by **signature** rather than by a cluster's position
 * in one execution's digest, so it survives a re-execution and carries what has happened to it
 * across them (ADR-0028). And it names nobody — this is level two, and a name first appears one
 * click further in (SPEC §7.1).
 *
 * **It is a `LedgerRow`, and the stub carries the severity stack** (§1.2 M2, M3). A stub holds
 * locators and nothing else, and the four-dot column is one: it is the same magnitude in the same
 * place down the whole list, so severity is comparable by eye before a single word is read. The
 * word is beside it in the content column, because severity is never colour alone (§4.2) — the
 * stack in the stub is decorative *precisely because* the word is present, which is the same
 * trade `SeverityTag` makes internally. The 72px column, the spine, the selection gutter and the
 * collapse below `--breakpoint-md` all belong to `Ledger`; a findings list wraps its rows in one.
 *
 * **What has happened to this problem is said in the words §7.3 fixes.** *"gone quiet"*,
 * *"not reported"* — an absence from the newest execution is an absence, and the row cannot spell
 * the word "fixed" about the product's own behaviour. The only "fixed" this component can print
 * is the one a **human** typed on the triage control, and it is printed as *"marked fixed"*, with
 * the person's authorship in the verb.
 *
 * **No hue is borrowed for a state.** `critical`/`high`/`medium`/`low` mean severity and only
 * severity (§4.1), so the four cluster states are carried by their word in a square `Badge` and
 * the severity ink stays where it belongs. The row's one lime appearance is `theOne`, which marks
 * the incidence figure and nothing else (§5.4, appearance 1).
 *
 * **Per-cohort incidence is deliberately absent.** "Six of the twelve first-timers and none of the
 * eight sceptics" is drawn by `IncidenceBars` (organism 22), which is a panel instrument; bars
 * inside a list row cannot be compared down a column and §1.3 rule 10 keeps ornament out of a
 * cell. The row states the aggregate and links to the page that draws the rest.
 */

/** §7.3's vocabulary, verbatim. Copy, not styling — no variant belongs in here. */
const STATE_WORDS = {
  new: "new",
  open: "open",
  fixed: "not reported",
  regressed: "back",
} satisfies Record<ClusterState, string>;

/**
 * The short form of `TriageForm`'s decisions, for a row that has no room for the full sentence.
 * "fixed" survives here because a human asserted it about their own product, and the row prints
 * it as *marked fixed* so the assertion keeps its author (§7.3).
 */
const TRIAGE_WORDS: Record<string, string> = {
  accepted: "accepted",
  fixed: "fixed",
  "wont-fix": "won't fix",
  duplicate: "a duplicate",
};

/** The serif step the title takes at each density. 13px is the serif floor (§1.3 rule 6). */
const TITLE_SIZE = {
  default: "finding",
  tight: "read-sm",
} satisfies Record<Density, "finding" | "read-sm">;

/** The stack shrinks with the row, so a tight row keeps its 32px height. */
const STACK_SIZE = {
  default: "md",
  tight: "sm",
} satisfies Record<Density, "sm" | "md">;

/**
 * What has become of this problem, in a sentence the product is willing to stand behind.
 *
 * Every branch either names an execution or says how long ago, and none of them claims a repair:
 * an absence is reported as *"last reported in execution 6"*, never as *"fixed in 7"*. The
 * measured reason is in ADR-0028's amendment — identical wording recurs every time and a reworded
 * complaint recurs never, so a signature that stops appearing may be a silence in the language
 * rather than a change in the product.
 */
function stateDetail(cluster: ClusterCardView, currentSeq: number | undefined): string {
  const lastSeenIn = cluster.seenIn.at(-1);
  const firstSeenIn = cluster.seenIn.at(0);
  switch (cluster.state) {
    case "new":
      return firstSeenIn === undefined
        ? `first reported ${ago(cluster.firstSeenAt)}`
        : `first reported in execution ${firstSeenIn}`;
    case "regressed":
      return currentSeq === undefined
        ? `reported again ${ago(cluster.lastSeenAt)}`
        : `absent, and reported again in execution ${currentSeq}`;
    case "fixed":
      return lastSeenIn === undefined
        ? `not reported since ${ago(cluster.lastSeenAt)}`
        : `last reported in execution ${lastSeenIn}`;
    default:
      return `reported in ${plural(cluster.seenIn.length, "execution")}`;
  }
}

export interface ClusterRowProps {
  cluster: ClusterCardView;
  /** Where the problem's own page is. The whole row is the link. */
  to: string;
  density?: Density;
  /** The execution being read, so "back" can name the one it came back in. */
  currentSeq?: number;
  /** The one that matters on this screen: its incidence figure takes the marker band (§5.4). */
  theOne?: boolean;
}

export const ClusterRow = forwardRef<HTMLElement, ClusterRowProps>(function ClusterRow(
  { cluster, to, density = "default", currentSeq, theOne = false },
  ref,
) {
  const severity: SeverityLevel = cluster.severity;
  const verdict: VerdictValue = cluster.verdict ?? "unchecked";
  const triageWord =
    cluster.triage === null ? undefined : TRIAGE_WORDS[cluster.triage.state];

  const facts: readonly MetaFact[] = [
    {
      key: "people",
      node: (
        <Text size="meta" tone="muted" marked={theOne}>
          {`${cluster.peopleHit} of ${people(cluster.peopleTotal)}`}
        </Text>
      ),
    },
    { key: "reports", node: plural(cluster.reports, "report") },
    { key: "verdict", node: <VerdictTag value={verdict} /> },
    { key: "state", node: stateDetail(cluster, currentSeq) },
    { key: "triage", node: triageWord === undefined ? null : `marked ${triageWord}` },
  ];

  return (
    <LedgerRow
      ref={ref}
      to={to}
      density={density}
      stub={
        // The stack is the locator, and it is decoration here *because* the word is beside it in
        // the content column — the same trade `SeverityTag` makes inside itself.
        <span aria-hidden="true" className="flex md:justify-end">
          <SeverityStack level={severity} size={STACK_SIZE[density]} />
        </span>
      }
    >
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <SeverityTag level={severity} kind={cluster.kind} />
          {cluster.tool === null ? null : (
            <ToolName name={cluster.tool} missing={cluster.kind === "coverage-gap"} />
          )}
          <Spacer />
          <Badge variant="status" tone={cluster.state === "fixed" ? "neutral" : undefined}>
            <VisuallyHidden>this problem is </VisuallyHidden>
            {STATE_WORDS[cluster.state]}
          </Badge>
        </div>

        <Text as="div" size={TITLE_SIZE[density]} tone="ink">
          {cluster.title}
        </Text>

        <MetaLine facts={facts} />
      </div>
    </LedgerRow>
  );
});
