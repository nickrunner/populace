import { Link as RouterLink } from "react-router-dom";

import {
  AbsenceDiagram,
  Button,
  CoverageDiagram,
  GapDiagram,
  Heading,
  Inline,
  MarketingShell,
  Measure,
  ReachDiagram,
  Section,
  Stack,
  Text,
  VisitDiagram,
} from "../design/index.js";

/**
 * UseCases — the public route `/use-cases`, set in `MarketingShell`.
 *
 * **This page was 1,044 lines and is now a page.** It used to be four narrative case studies
 * built on this repository's development fixture — named thirteen times — with payload wells,
 * transcripts, a defect roll-call and authored counts presented as a real execution the reader
 * was invited to go and verify. All of that is gone, and §9 was rewritten to say so. What
 * replaced it is DESIGN-SYSTEM §9.3 and §9.4 taken literally:
 *
 *  - **A figure opens every section**, and the prose under it is a blurb, not an essay. The nine
 *    figures in `brand/diagrams/` already explain these mechanisms better than a paragraph does,
 *    and four of them do the whole of this page's work.
 *  - **Nothing is named that a stranger would have to learn.** The examples are shapes — a
 *    feature, a description, a first visit, a second execution — and the tool names inside the
 *    figures are generic by construction (`create_item`, `search`, `export_report`).
 *  - **Every figure here is drawing its own example**, so every one of them prints the word
 *    *illustrative* in its own header. That is `DiagramFigure`'s `sample` flag, computed from
 *    whether a data prop was passed, which is why this file passes none. **No number on this
 *    page is a measurement, and none is offered as one.**
 *
 * **The honesty clause is a section and not a footnote** (§7.3, §9.7). `AbsenceDiagram` carries
 * the preserved sentences itself — they are constants in `Figure.js`, not props — so the page
 * cannot ship a gentler wording of them. The marked phrase beneath it is the page's one lime
 * band, and it is spent on the rule rather than on a boast.
 *
 * **Vocabulary.** The `/why-agents` carve-out is not spent here: this page is about what *people*
 * ran into in a product, and the product's own word for one of them is *person*.
 */

/** The page's one marked phrase (§5.4). */
const ABSENCE_RULE = "An absence is not a fix.";

/**
 * One scenario's blurb: the serif at the lede step, one measure wide, sitting *under* its figure.
 * Declared once because it appears four times and the rhythm is the page's structure — figure,
 * then two sentences, then the next figure.
 */
function Blurb({ children }: { children: string }) {
  return (
    <Measure as="p" width="lede">
      <Text size="lede" tone="soft" as="span">
        {children}
      </Text>
    </Measure>
  );
}

export function UseCases() {
  return (
    <MarketingShell>
      <Stack gap={12}>
        {/* ---- THE HERO --------------------------------------------------------------- */}
        <Stack gap={8} align="start">
          <div>
            <Text as="p" size="eyebrow" tone="muted">
              Use cases
            </Text>
            {/*
              Space Grotesk 300 (§3.1, named exception 1) — the same step and weight the landing's
              masthead takes, so the 700 wordmark in the frame above stays the boldest thing on
              the page and the serif never appears at display size over cream (§1.4).
            */}
            <Heading level={1} size="masthead">
              What your users run into, and your tests do not.
            </Heading>
          </div>

          <Measure as="p" width="lede">
            <Text size="lede" tone="soft" as="span">
              A green build tells you the code does what somebody asked it to. It does not tell you
              whether anyone can find the feature, or whether its description is true.
            </Text>
          </Measure>

          {/*
            The thesis as a picture rather than as a third paragraph: one surface drawn twice —
            the path a suite asserts, and where a population actually went. It defaults to no
            caption because its two halves name themselves, and the lede above is its text
            equivalent.
          */}
          <ReachDiagram size="hero" className="w-full" />
        </Stack>

        {/* ---- 1. DISCOVERABILITY ------------------------------------------------------ */}
        <Section id="discoverability" title="Nobody finds the feature">
          <Stack gap={6} align="start">
            <GapDiagram size="hero" className="w-full" />
            <Blurb>
              Your feature works and every assertion on it passes. That says nothing about whether a
              person ever arrives at it. Finding a thing is not a step a test takes.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- 2. A PROMISE WITH NOTHING BEHIND IT ------------------------------------- */}
        <Section id="promises" title="The copy promises something the product cannot do">
          <Stack gap={6} align="start">
            {/*
              `CoverageDiagram`'s own example surface carries one capability that is promised and
              not exposed, which is the whole scenario — so the figure is the argument and the
              blurb underneath is two sentences of framing.
            */}
            <CoverageDiagram size="panel" className="w-full" />
            <Blurb>
              Your landing page, your docs and your tool descriptions all make promises. A
              population reads them, goes looking, and files what it could not find.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- 3. THE FIRST VISIT ------------------------------------------------------ */}
        <Section id="onboarding" title="A first visit, by somebody who knows nothing">
          <Stack gap={6} align="start">
            <VisitDiagram size="panel" className="w-full" />
            <Blurb>
              Nobody arrives knowing anything — no tour, no sample data, no account. What a person
              reaches in their first visit is a reading of how legible your product is to a
              stranger.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- 4. READING A SECOND EXECUTION ------------------------------------------- */}
        <Section id="across-executions" title="Reading a second execution">
          <Stack gap={6} align="start">
            {/*
              The figure first, and the rule after it. `AbsenceDiagram` draws the pair — a record
              on one side and deliberately no record on the other — and prints §7.3's preserved
              sentences from `Figure.js` rather than from a prop, so no call site can soften them.
            */}
            <AbsenceDiagram size="hero" className="w-full" />

            {/*
              The page's one marker band (§5.4), at the lede measure rather than the statement
              measure: `ch` resolves against the box's own font, and 34ch of this step would orphan
              the phrase's last word inside a lime band.
            */}
            <Measure as="p" width="lede">
              <Text size="statement" tone="ink" as="span" marked>
                {ABSENCE_RULE}
              </Text>
            </Measure>

            <Blurb>
              Send the same simulation in again and the people do different things. A problem nobody
              reported this time is reported as an absence. Whether your product is fixed is your
              call, and there is a field to record it in.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- THE CLOSE --------------------------------------------------------------- */}
        <Section id="start" title="Start one">
          <Stack gap={6} align="start">
            <Blurb>
              Point a population at any app that exposes an MCP server, give it an errand, and read
              what came back.
            </Blurb>
            <Inline gap={3} align="center" wrap>
              <Button asChild variant="primary" size="lg">
                <RouterLink to="/app">Set up a project</RouterLink>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <RouterLink to="/how-it-works">See how it works</RouterLink>
              </Button>
            </Inline>
          </Stack>
        </Section>
      </Stack>
    </MarketingShell>
  );
}
