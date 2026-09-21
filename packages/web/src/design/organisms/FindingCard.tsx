import { forwardRef } from "react";
import type { ClusterCardView } from "@populace/contract";
import type { ToolCallRecord } from "@populace/contract";

import { ago, people, plural } from "../../format.js";
import { cn } from "../cn.js";
import type { SeverityLevel, VerdictValue } from "../tokens.js";
import { Badge, Heading, Spacer, Stack, Text } from "../atoms/index.js";
import { CallRef, MetaSentence, SeverityTag, ToolName, VerdictTag } from "../molecules/index.js";
import { surfaceBase } from "../variants.js";
import { Card, type CardPad } from "./Card.js";

/**
 * FindingCard — one problem, with its receipts, as a self-contained record
 * (ATOMIC-INVENTORY §3, organism 23).
 *
 * `ClusterRow` is for a list: scanned down a column, compared against its neighbours, stripped to
 * facts. This is the other half of the pair — a card read **once**, on the landing page and
 * wherever the product has to show what a finding actually is. That difference is the whole API:
 * the row gets a `MetaLine` of hairline-separated facts because prose cannot be compared down a
 * column, and the card gets a `MetaSentence`, with real pluralisation and a real verb (§4.5).
 *
 * Three registers stack inside it and none of them is boxed (§1.2 M1): a sans severity word and a
 * mono tool name, a serif finding-sentence, then — when there are receipts — the mono evidence
 * seam in a recessed well, and a person's italic voice at the foot. Family alone says which is
 * which, so the card survives greyscale and a total webfont failure.
 *
 * **The evidence is the seam, not a payload.** Each step is its call ref and the tool it named,
 * which is what makes the judge's replay possible (ADR-0015). What was sent and what came back
 * belong in `PayloadBlock` on the finding's own page; a card that inlined them would be a
 * transcript with a title.
 *
 * **Italic belongs to people** (§4.7). `t-voice` is the only italic in the system and the quote is
 * the only thing here allowed to use it — the card's own sentences are upright serif, because
 * there the product is speaking.
 *
 * **Nothing here promises a repeat.** A cluster the newest execution did not report is described
 * as *an absence, not a repair* (§7.3) — verbatim, because the alternative reading is the one
 * expensive mistake this screen can make.
 */

/** 16px at full size, 14px at 0.8 — `Card`'s own two steps. A card owns its padding, so nothing
 *  here writes a `p-4`, which is the class string §3's `Card` note exists to end. */
const CARD_PAD = {
  1: "default",
  0.8: "tight",
} satisfies Record<1 | 0.8, CardPad>;

/**
 * The serif step the title takes at each scale. `read` rather than `read-sm` at 0.8: the title is
 * the one sentence that IS the product, and 13px is the floor for a sentence in a dense row, not
 * for the headline of a card (§1.3 rule 6).
 */
const TITLE_SIZE = {
  1: "finding",
  0.8: "read",
} satisfies Record<1 | 0.8, "finding" | "read">;

/** A verbatim quote carries the words a person typed. The one place `t-voice` is legal. */
export interface FindingQuote {
  name: string;
  words: string;
  visit: number;
}

export interface FindingCardProps {
  cluster: ClusterCardView;
  /**
   * The reproduction steps, in order. `ReproductionStepView` was a name for a shape that already
   * has one: the steps a finding carries are `ToolCallRecord`s, which is what
   * `ClusterDetailView.reproduction` is made of and what the verifier replays. The contract
   * re-exports the record; the inventory has been amended to name it.
   */
  evidence?: readonly ToolCallRecord[];
  /** One person's words about it. A name is allowed here — this is the level that may (SPEC §7.1). */
  quote?: FindingQuote;
  /** 1 on the finding's own page and the landing hero; 0.8 in a proof strip beside other cards. */
  scale?: 1 | 0.8;
}

/**
 * What the card says about incidence, as sentences rather than as a fact line.
 *
 * "Nine of twelve people hit this" is the number the whole restructure is for, and it is written
 * out because a card is read once (§4.5). The absence clause is the careful one: `state: "fixed"`
 * is the wire's word for *the newest execution did not report it*, and it is rendered as exactly
 * that, with §7.3's phrase kept intact.
 */
function incidenceWords(cluster: ClusterCardView): string {
  const sentences: string[] = [
    `${cluster.peopleHit} of ${people(cluster.peopleTotal)} hit this, in ${plural(cluster.reports, "report")}.`,
  ];

  if (cluster.firstSeenAt !== null) {
    sentences.push(
      cluster.lastSeenAt === null || cluster.lastSeenAt === cluster.firstSeenAt
        ? `First reported ${ago(cluster.firstSeenAt)}.`
        : `First reported ${ago(cluster.firstSeenAt)}, last reported ${ago(cluster.lastSeenAt)}.`,
    );
  }

  if (cluster.state === "fixed") {
    sentences.push("The newest execution did not report it — an absence, not a repair.");
  }
  if (cluster.state === "regressed") {
    sentences.push("It was absent for a while and has been reported again.");
  }

  return sentences.join(" ");
}

export const FindingCard = forwardRef<HTMLElement, FindingCardProps>(function FindingCard(
  { cluster, evidence, quote, scale = 1 },
  ref,
) {
  const severity: SeverityLevel = cluster.severity;
  const verdict: VerdictValue = cluster.verdict ?? "unchecked";
  const titleSize = TITLE_SIZE[scale];

  return (
    <Card ref={ref} pad={CARD_PAD[scale]}>
      <Stack gap={2}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <SeverityTag level={severity} kind={cluster.kind} withStack />
          {cluster.tool === null ? null : (
            <ToolName name={cluster.tool} missing={cluster.kind === "coverage-gap"} />
          )}
          <Spacer />
          <VerdictTag value={verdict} />
        </div>

        <Heading level={3} size={titleSize}>
          {cluster.title}
        </Heading>

        <MetaSentence>{incidenceWords(cluster)}</MetaSentence>

        {evidence === undefined || evidence.length === 0 ? null : (
          <div className="mt-1">
            <Text as="div" size="label" tone="muted" className="mb-1.5">
              what they did
            </Text>
            {/*
             * The evidence seam: recessed ground, square, a 2px `evidence` left edge — the one
             * 2px content border in the system besides focus (§4.3). `surfaceBase`'s `well`
             * carries all three, and publishes `--focus-sep` so a focusable ref inside it draws
             * its separator band in the colour immediately behind it.
             */}
            <ol className={cn(surfaceBase({ level: "well" }), "grid gap-1.5 p-3")}>
              {evidence.map((step) => (
                <li key={step.ref} className="flex flex-wrap items-baseline gap-2">
                  <CallRef callRef={step.ref} />
                  <ToolName name={step.tool} />
                  {step.result.isError ? <Badge variant="bad">error</Badge> : null}
                </li>
              ))}
            </ol>
          </div>
        )}

        {quote === undefined ? null : (
          <figure className="mt-1 grid gap-1">
            <blockquote>
              <Text as="p" size="voice" tone="ink">
                {`“${quote.words}”`}
              </Text>
            </blockquote>
            <Text as="figcaption" size="meta" tone="muted">
              {`${quote.name}, on visit ${quote.visit}`}
            </Text>
          </figure>
        )}
      </Stack>
    </Card>
  );
});
