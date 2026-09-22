import { Link as RouterLink } from "react-router-dom";

import {
  Button,
  EXECUTIONS_ARE_INDEPENDENT,
  Fact,
  FactList,
  FigureStrip,
  Heading,
  Inline,
  Link,
  MarketingShell,
  Measure,
  Mono,
  NOT_A_REPAIR,
  PipelineDiagram,
  Section,
  Separator,
  Stack,
  Text,
  VisitDiagram,
} from "../design/index.js";
import type { FigureStripItem } from "../design/index.js";

/**
 * HowItWorks — the public route `/how-it-works` (DESIGN-SYSTEM §9).
 *
 * **This page owns the mechanism and nothing else.** A population is composed, its people visit
 * your app through its MCP server, they file findings that cite the exact calls, and a pipeline
 * verifies, clusters and renders a digest. Anything that is not one of those beats belongs on
 * `/concepts` or `/why-agents`, and this page **links rather than restates** (§9.3).
 *
 * ---------------------------------------------------------------------------------------------
 * **THE PAGE IS THE SITE'S OUTLIER AND THIS IS THE THIRD CUT.** It measured 1,491 rendered words
 * and 8,666px against `/concepts` at 672 and 3,880. Two earlier rounds removed `#evidence`
 * outright, turned the variance and absence material into a link, and reduced the guardrails to a
 * strip and four rows. This round removed the last section that was not this page's own and took
 * every remaining paragraph to a line.
 *
 *  1. **`#the-arc` is deleted.** `StepStrip` is the landing page's block, rendered there
 *     identically; a reader who arrived here from `/` read it thirty seconds ago, and the two
 *     figures below say the same five steps with the mechanism attached. Repeating it was the
 *     clearest case of the thing §9.3 forbids.
 *  2. **Every paragraph is now one or two sentences.** No prose block on this page runs past
 *     twenty words, and the only prose under a figure is the thing the figure cannot draw.
 *  3. **The guardrails are a lookup, not a read.** Four shipped ceilings in a `FigureStrip`, four
 *     `Fact` rows for what is not a number. Nothing between them is a sentence.
 *
 * **What remains is two figures and about a hundred and fifty words.** `VisitDiagram` and
 * `PipelineDiagram` carry roughly 870 of the page's rendered words between them, inside their own
 * `<figure>` elements — the page's whole remaining weight. They are the four beats above, drawn,
 * and neither is duplicated by prose here. Bringing the page below this line means editing those
 * two components, not this file.
 * ---------------------------------------------------------------------------------------------
 *
 * **The examples are generic** (§9.4) — "your app", "your server", `create_item` — and nothing
 * names the target this repository develops against.
 *
 * **Every number here is a shipped default** in `GuardrailsSchema`, and the strip names its basis
 * on its own rule. Nothing on the page is offered as a measurement, because nothing on it was
 * measured (§9.6).
 *
 * **No spine and no stub** (§9.2). Nothing animates.
 *
 * Anchors: `#one-visit`, `#pipeline`, `#guardrails`, `#not-a-promise`, `#start`.
 */

/** The descriptor, verbatim from the brand kit and from §7.2. Not to be reworded. */
const DESCRIPTOR = "Autonomous testing for MCP apps.";

/**
 * The shipped ceilings, printed as they ship. An engineer's second question after "what does it
 * do" is "what can it spend", and the only honest answer to that is a number.
 */
const CEILINGS: readonly FigureStripItem[] = [
  { id: "tokens", label: "Tokens, one visit", value: "400,000" },
  { id: "dollars", label: "Dollars, one visit", value: "$3" },
  { id: "turns", label: "Model turns, one visit", value: "40" },
  { id: "daily", label: "Dollars, one population", value: "$50", note: "Trailing 24 hours." },
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
              AI people use your app through its MCP server. What stops them comes back with the
              calls that caused it.
            </Text>
          </Measure>
        </Stack>

        {/* ---- 1. ONE VISIT ------------------------------------------------------------ */}
        {/*
          The first three beats in one figure: a person out of a cohort, your tools and ours as
          one list, every result numbered, a finding citing the numbers. The two lines under it
          are the only two things the picture cannot draw.
        */}
        <Section id="one-visit" title="One visit">
          <Stack gap={6}>
            <VisitDiagram size="panel" />

            {/* The page's one marker band (§5.4), spent *after* the picture (§9.3). */}
            <Measure as="p" width="statement">
              <Text size="statement" tone="ink" as="span" marked>
                A finding is a tool call, or it does not exist.
              </Text>
            </Measure>

            <Measure as="p" width="read">
              <Text size="read-sm" tone="muted" as="span">
                Nothing runs between visits. A person&rsquo;s persona, account and memory are rows.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- 2. THE PIPELINE --------------------------------------------------------- */}
        {/*
          No caption and no prose. The figure's own lede says one report per thing one person ran
          into, its stages draw the replay and the signature, and its figcaption carries §7.3.
        */}
        <Section id="pipeline" title="Findings become a digest">
          <PipelineDiagram size="panel" />
        </Section>

        {/* ---- 3. GUARDRAILS ----------------------------------------------------------- */}
        {/* A lookup, not a read: four numbers, then four rows for what is not a number. */}
        <Section id="guardrails" title="What stops it, and what it costs">
          <Stack gap={8}>
            <FigureStrip items={CEILINGS} basis={{ kind: "measured", source: "Shipped defaults" }} />

            <div className="w-full">
              <FactList>
                <Fact label="Checked in code">In the runner, before every model call.</Fact>
                <Fact label="Kill switch">A flag in the store. Nothing new starts.</Fact>
                <Fact label="Tool lists">Allow and deny globs. Deny wins.</Fact>
                <Fact label="Destructive tools">
                  Allow, confirm or deny, from <Mono size="code-inline">destructiveHint</Mono>.
                </Fact>
              </FactList>
            </div>
          </Stack>
        </Section>

        {/* ---- 4. THE HONESTY CLAUSE --------------------------------------------------- */}
        {/*
          §9.7: a section rather than a footnote, a rule above and below, air, `t-lede` serif, no
          icon and no tint. Two sentences and a link — `/why-agents` draws this with
          `VarianceDiagram` and `AbsenceDiagram`, and restating it here was one of the reasons
          this page was twice the length of its siblings.
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
                    A problem that stops appearing is {NOT_A_REPAIR}.{" "}
                  </Text>
                  <Link to="/why-agents" size="read">
                    Why that is the design
                  </Link>
                </Measure>
              </Stack>
            </div>
            <Separator />
          </div>
        </Section>

        {/* ---- 5. THE CLOSE ------------------------------------------------------------ */}
        <Section id="start" title="Start">
          <Stack gap={6} align="start">
            <Measure as="p" width="lede">
              <Text size="lede" tone="soft" as="span">
                The dashboard prices a simulation before it spends anything. A live run needs an
                Anthropic API key.
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
