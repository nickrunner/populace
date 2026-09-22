import { Link as RouterLink } from "react-router-dom";

import {
  AbsenceDiagram,
  Button,
  Heading,
  Inline,
  MarketingShell,
  Measure,
  ReachDiagram,
  Section,
  SectionRule,
  Separator,
  Stack,
  Text,
} from "../design/index.js";

/**
 * WhyAgents — the public route `/why-agents` (DESIGN-SYSTEM §9).
 *
 * The argument page. It answers one question — why send people who do not know your app, rather
 * than write another assertion — and then it spends the second half on what that costs you.
 *
 * **This page owns `ReachDiagram`.** `/use-cases` opened on the same figure at the same size with
 * the same built-in sentence, so two of five pages shared their first scroll. The contrast that
 * figure draws *is* this page's thesis — a suite walks a line somebody thought of, a population
 * wanders — and the page exists to argue it, so the figure stays here and `/use-cases` opens on a
 * result instead. Nothing on this page now appears on that one: `GapDiagram` and
 * `VarianceDiagram` went there, `ReachDiagram` and `AbsenceDiagram` stayed here.
 *
 * The order is the argument:
 *
 *  1. the hero — a claim about test suites, not about this product, because the reader already
 *     distrusts claims about this product and does not distrust this one;
 *  2. `#reach` — `ReachDiagram`. One surface drawn twice: the line a suite walks, and where a
 *     population went. The silhouette lands before a word of it is read, and the one marked
 *     sentence on the page is the claim it is evidence for;
 *  3. the hinge — one rule. The case is above it; what it costs you is below;
 *  4. `#limits` — the honesty, at the weight §9.7 asks for. `AbsenceDiagram` leads, the clause
 *     follows it full measure between two rules with 48px of air, then the four limits at one
 *     sentence each, then the one thing that does hold still.
 *
 * **The limits keep equal weight**, and that is what makes the page persuasive rather than
 * salesy. §7.3 binds this page exactly as hard as it binds the product: nothing here promises
 * determinism, and a problem absent from the newest execution is an absence, never a repair.
 * **Each of those sentences is printed once.** The clause block, the figure's own caption and the
 * limit beneath them used to say it three times within one screen; the figure carries the
 * preserved wording, and the page's own two lines say what the figure cannot draw.
 *
 * **The word "agents"** is the brand's, and `/why-agents` is the carve-out (§9, `MarketingShell`)
 * — the argument is literally about what an autonomous agent does that a scripted assertion
 * cannot. It is spent in the hero and nowhere below it, where the words are the product's:
 * population, cohort, person, visit, execution, finding. Nothing was added to a shared component
 * for this page, so the carve-out reaches no further than this file.
 *
 * **Nothing animates**, which is the strongest way to honour `prefers-reduced-motion`: there is
 * nothing to reduce. No clay, and no forest band — the band appears once on the site, behind the
 * chain diagram (§9.9).
 */

/** The masthead. Space Grotesk 300 at display size (§3.1, named exception 1). */
const MASTHEAD = "Every test you have asserts a path somebody already thought of.";

/** The page's one marked line (§5.4). The argument, in a sentence. */
const THESIS =
  "A population that has never seen your app is the only instrument that finds the paths nobody thought of.";

/**
 * The four limits, one sentence each.
 *
 * Each says the part the clause block above them does not. The block owns "there is no
 * determinism setting" and "whether it is fixed is your call"; these four owe the reader
 * something further, and a limit that only restated the block was deleted rather than reworded.
 *
 * `cast` is the fifth line and it is not here, because it is the one thing that *does* hold
 * still — it sits under the grid as the counterweight rather than in this list.
 */
const LIMITS: readonly { name: string; body: string }[] = [
  {
    name: "Outcomes vary, by design",
    body: "Two executions of one simulation produce different prose, different counts and different costs. Read the overlap between them, not the difference.",
  },
  {
    name: "An absence is not a repair",
    body: "A problem that stops being reported may be gone, or may have been described in different words this time. The verifier judges findings; it cannot judge a silence.",
  },
  {
    name: "It spends real money",
    body: "Every visit is a run of model calls. That is why the ceilings live in the runner and are checked before each call — a ceiling in a prompt is a request.",
  },
  {
    name: "A finding is not a proof",
    body: "It is a report from a simulated user. A verifier sends the exact calls it cites to your app again, and says so plainly when it still cannot tell.",
  },
];

export function WhyAgents() {
  return (
    <MarketingShell>
      <Stack gap={12}>
        {/* ---- THE HERO ---------------------------------------------------------------- */}
        <Stack gap={6} align="start">
          <div>
            <Text as="p" size="eyebrow" tone="muted">
              The argument, and its limits
            </Text>
            <Heading level={1} size="masthead">
              {MASTHEAD}
            </Heading>
          </div>

          <Measure as="p" width="lede">
            <Text size="lede" tone="soft" as="span">
              Populace sends a population of AI agents into your app through its MCP server. Nobody
              shows them around. What stops them comes back as a finding, carrying the exact calls
              that produced it.
            </Text>
          </Measure>

          <Inline gap={3} align="center" wrap>
            <Button asChild variant="primary" size="lg">
              <a href="#limits">Read the limits first</a>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <RouterLink to="/app">Open the dashboard</RouterLink>
            </Button>
          </Inline>
        </Stack>

        {/* ---- THE CASE, IN ONE PICTURE ------------------------------------------------ */}
        <Section id="reach" title="A suite walks a line. A population wanders.">
          <Stack gap={6} align="start">
            {/*
              The figure leads, and it is the argument (§9.3). Its two halves carry their own
              names, counts and sentences, and its lede already says what a test checks and where
              a population goes — so the page adds the claim the picture is evidence for, once,
              and stops. This is the figure `/use-cases` used to open on as well; it is this
              page's, and the other one opens on a result now.
            */}
            <ReachDiagram size="hero" />

            <Measure as="p" width="statement">
              <Text size="statement" tone="ink" as="span" marked>
                {THESIS}
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* The hinge. The case is above it; what it costs you is below. One rule on the page. */}
        <SectionRule glyph="dots" count={3} />

        {/* ---- THE LIMITS -------------------------------------------------------------- */}
        <Section id="limits" title="What it will not do for you" trailing="4 limits">
          <Stack gap={8} align="start">
            {/*
              The honesty leads with its figure, the way every other section on the site does
              (§9.3). `AbsenceDiagram` draws the pair — a problem filed in one execution with the
              calls that reproduce it, and deliberately no record of it in the next — and prints
              §7.3's preserved sentences from `Figure.js` rather than from a prop, so no call site
              can soften them.
            */}
            <AbsenceDiagram size="hero" />

            {/*
              §9.7's treatment, verbatim: full measure, a rule above and below, 48px of air, serif
              lede, no icon and no tint. It is the second most emphatic block on the page, and it
              is a limit rather than a feature — which is the point of giving it that weight. It
              says the two things the figure above cannot draw, and does not repeat the one it
              can: that there is no setting for this, and that reading the second execution is
              your job rather than the product's.
            */}
            <div className="w-full">
              <Separator />
              <div className="py-12">
                <Measure as="p" width="lede">
                  <Text size="lede" tone="ink" as="span">
                    There is no determinism setting, and there will not be one. A second execution
                    is a second reading: what its people did not reach this time is not the same
                    thing as what you repaired.
                  </Text>
                </Measure>
              </div>
              <Separator />
            </div>

            <div className="grid w-full gap-x-10 gap-y-8 md:grid-cols-2">
              {LIMITS.map((limit) => (
                <div key={limit.name}>
                  <Heading level={3} size="eyebrow" tone="ink">
                    {limit.name}
                  </Heading>
                  <div className="mt-2">
                    <Measure as="p" width="read">
                      <Text size="read" tone="soft" as="span">
                        {limit.body}
                      </Text>
                    </Measure>
                  </div>
                </div>
              ))}
            </div>

            {/*
              The counterweight, and the one sentence on this site that must not attribute
              sameness to a seed (ADR-0031): a model call is not a pure function of a seed, so
              people are stable because THE ROW IS STORED. Changing a cohort's seed renames
              nobody; it decides who the next person is, not who these people are.
            */}
            <Measure as="p" width="read">
              <Text size="read" tone="soft" as="span">
                One thing does hold still. Each person is a stored row — a name and a line of their
                own, written once and never overwritten — so the same individuals come back
                execution after execution. Nothing redraws them, and changing a cohort&rsquo;s seed
                renames nobody.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- THE CLOSE --------------------------------------------------------------- */}
        <Section id="start" title="What you need to start">
          <Stack gap={6} align="start">
            <Measure as="p" width="lede">
              <Text size="lede" tone="ink" as="span">
                An MCP server in front of your app, and somewhere for strangers to sign up. The
                rest is a population and a press of go.
              </Text>
            </Measure>

            <Inline gap={3} align="center" wrap>
              <Button asChild variant="primary" size="lg">
                <RouterLink to="/app">Open the dashboard</RouterLink>
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
