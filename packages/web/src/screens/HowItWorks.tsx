import { Link as RouterLink } from "react-router-dom";

import {
  AN_ABSENCE_ONLY,
  Button,
  EXECUTIONS_ARE_INDEPENDENT,
  EvidenceDiagram,
  Fact,
  FactList,
  FigureStrip,
  Heading,
  Inline,
  MarketingShell,
  Measure,
  Mono,
  PipelineDiagram,
  Section,
  Separator,
  Stack,
  StepStrip,
  Text,
  VisitDiagram,
} from "../design/index.js";
import type { FigureStripItem } from "../design/index.js";

/**
 * HowItWorks — the public route `/how-it-works` (DESIGN-SYSTEM §9).
 *
 * **A sequence of figures with captions, and very little else.** §9.3 is the whole brief: the
 * graphic opens each section, the caption is a line, and a section that needs three paragraphs
 * after its picture has not found its picture yet. This page previously ran 670 lines of prose
 * around the same four figures — it is now the figures, plus what they cannot draw.
 *
 * **Nothing here says what a figure beside it already says.** Each mechanism figure carries its
 * own lede above the picture and its own `<figcaption>` under it, so a page paragraph about two
 * toolsets as one list, about a judge replaying the cited calls, or about clustering by
 * signature was a sentence the reader had already met twice. Those four are gone; `#pipeline` is
 * now the figure alone. What survives is what a picture cannot hold — that nothing runs between
 * visits, and the ceilings.
 *
 * **The figure leads and the marked line lands under it** (§9.3): *a finding is a tool call, or
 * it does not exist* headed `#evidence` as a claim, and reads under `EvidenceDiagram` as the
 * caption of a picture that just showed it. **`#guardrails` is a strip and a list** — what stops
 * this and what it costs is a lookup, not a read.
 *
 * **The examples are generic** (§9.4). No fixture, no reference target, no product name that is
 * not the reader's own: `StepStrip` and the three mechanism figures all speak of "your app", and
 * nothing on this page names the target this repository develops against.
 *
 * **Every number here is a shipped default** in `GuardrailsSchema`, and the strip says so on its
 * own rule rather than in a sentence. Nothing on the page is presented as a measurement of
 * anything, because nothing on it was measured (§9.6).
 *
 * **No spine and no stub** (§9.2): this page is a reading column, so there are no `Ledger`
 * wrappers around prose and nothing indents to `--w-stub`. Nothing animates.
 *
 * Anchors: `#the-arc`, `#one-visit`, `#evidence`, `#pipeline`, `#guardrails`, `#not-a-promise`,
 * `#start`.
 */

/** The descriptor, verbatim from the brand kit and from §7.2. Not to be reworded. */
const DESCRIPTOR = "Autonomous testing for MCP apps.";

/**
 * The shipped ceilings, printed as they ship. An engineer's second question after "what does it
 * do" is "what can it spend", and the only honest answer to that is a number.
 */
const CEILINGS: readonly FigureStripItem[] = [
  {
    id: "tokens",
    label: "Tokens, one visit",
    value: "400,000",
    /*
     * What the number counts, not where it is enforced: "checked before every model call" is
     * the first row of the list below, and a note that says it here says it twice.
     */
    note: "The whole session — prompt, tools and results.",
  },
  { id: "dollars", label: "Dollars, one visit", value: "$3", note: "What one session may cost." },
  { id: "turns", label: "Model turns, one visit", value: "40", note: "A hard cap on the loop." },
  {
    id: "daily",
    label: "Dollars, one population, one day",
    value: "$50",
    note: "Over the trailing 24 hours.",
  },
];

export function HowItWorks() {
  return (
    <MarketingShell>
      <Stack gap={12}>
        {/* ---- HERO -------------------------------------------------------------------- */}
        <Stack gap={6} align="start">
          <div>
            {/* §3.7's `.t-eyebrow + .t-title` pair owns the space between these two. */}
            <Text as="p" size="eyebrow" tone="muted">
              {DESCRIPTOR}
            </Text>
            <Heading level={1}>How Populace works</Heading>
          </div>

          <Measure as="p" width="statement">
            <Text size="statement" tone="ink" as="span">
              A population of AI people uses your app through its MCP server. What stops them comes
              back carrying the calls that caused it.
            </Text>
          </Measure>
        </Stack>

        {/* ---- 1. THE ARC -------------------------------------------------------------- */}
        {/*
          The page's spine, and the one legitimate numbered device on it (§8.6): this is an actual
          sequence — nothing is filed before somebody has visited, nothing clustered before it is
          filed — so the ordinals carry information rather than ornament.
        */}
        <Section id="the-arc" title="The arc" trailing="five steps">
          <StepStrip />
        </Section>

        {/* ---- 2. ONE VISIT ------------------------------------------------------------ */}
        <Section id="one-visit" title="One visit" trailing="the central mechanism">
          <Stack gap={6}>
            <VisitDiagram size="hero" />
            {/*
              The figure's own lede already says two toolsets, one list, a finding that cites
              calls. What it cannot draw is that nothing exists between the pictures.
            */}
            <Measure as="p" width="read">
              <Text size="read-sm" tone="muted" as="span">
                Nothing runs between visits. A person&rsquo;s persona, schedule, account and memory
                are rows — loaded when a visit starts, written back when it ends.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- 3. EVIDENCE ------------------------------------------------------------- */}
        <Section id="evidence" title="Evidence you can run again">
          <Stack gap={6}>
            <EvidenceDiagram size="hero" />

            {/*
              The page's one marker band (§5.4): lime as a ground under ink, spent once — and
              spent *after* the picture (§9.3). The figure draws the ref becoming a stored call
              and a judge replaying it; this is the line that picture is evidence for, so it
              reads as the caption rather than as the claim the reader must take on trust.
            */}
            <Measure as="p" width="statement">
              <Text size="statement" tone="ink" as="span" marked>
                A finding is a tool call, or it does not exist.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- 4. THE PIPELINE --------------------------------------------------------- */}
        <Section id="pipeline" title="Findings become a digest">
          {/*
            No caption. The figure's lede says one report per thing one person ran into, and its
            own figcaption says clustering is keyed by signature — a paragraph here could only
            say those twice.
          */}
          <PipelineDiagram size="hero" />
        </Section>

        {/* ---- 5. GUARDRAILS ----------------------------------------------------------- */}
        <Section id="guardrails" title="What it may spend, and what it may touch">
          <Stack gap={8}>
            <FigureStrip
              items={CEILINGS}
              basis={{ kind: "measured", source: "Shipped defaults" }}
            />

            {/*
              The ceilings are a strip and the rest is a list, because the question underneath
              this section — what stops it, what does it cost — is a lookup rather than a read.
              The paragraph that used to sit between the two said in forty words what the first
              row of the list says in twelve.
            */}
            <div className="w-full">
              <FactList>
                <Fact label="Checked in code">
                  In the runner, before every model call — never asked for in the prompt. All four
                  ceilings are yours to change.
                </Fact>
                <Fact label="Kill switch">
                  A flag in the store, read at every step. Nothing new starts and nothing in flight
                  continues.
                </Fact>
                <Fact label="Tool lists">
                  Allow and deny globs, on the target and on a persona. Deny wins, and a persona can
                  only take more away.
                </Fact>
                <Fact label="Destructive tools">
                  Driven by your server&rsquo;s <Mono size="code-inline">destructiveHint</Mono> —
                  allow, confirm or deny. Your annotations decide, not ours.
                </Fact>
                <Fact label="Accounts">
                  Every account an execution creates carries its tag, and the sweep tears them down
                  by tag.
                </Fact>
              </FactList>
            </div>
          </Stack>
        </Section>

        {/* ---- 6. THE HONESTY CLAUSE --------------------------------------------------- */}
        {/*
          §9.7: a section rather than a footnote, a rule above and below, air, `t-lede` serif, no
          icon and no tint. It is the second most emphatic block on the page and it binds this
          page exactly as hard as it binds the product (§7.3).
        */}
        <Section id="not-a-promise" title="What it will not promise">
          <div>
            <Separator />
            <div className="py-8">
              <Stack gap={4} align="start">
                <Measure as="p" width="lede">
                  <Text size="lede" tone="ink" as="span">
                    {EXECUTIONS_ARE_INDEPENDENT}
                  </Text>
                </Measure>
                <Measure as="p" width="lede">
                  <Text size="lede" tone="soft" as="span">
                    A problem missing from the newest execution is reported as an absence.{" "}
                    {AN_ABSENCE_ONLY} Whether it is fixed is your call, and there is a field to
                    record it.
                  </Text>
                </Measure>
              </Stack>
            </div>
            <Separator />
          </div>
        </Section>

        {/* ---- 7. THE CLOSE ------------------------------------------------------------ */}
        <Section id="start" title="Start">
          <Stack gap={6} align="start">
            <Measure as="p" width="lede">
              <Text size="lede" tone="soft" as="span">
                Point it at an MCP endpoint and the dashboard prices a simulation before it spends
                anything. A live run needs an Anthropic API key.
              </Text>
            </Measure>

            <Inline gap={3} align="center" wrap>
              <Button asChild variant="primary" size="lg">
                <RouterLink to="/projects">Point it at your app</RouterLink>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <RouterLink to="/concepts">Read the concepts</RouterLink>
              </Button>
            </Inline>
          </Stack>
        </Section>
      </Stack>
    </MarketingShell>
  );
}
