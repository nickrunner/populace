import { Link as RouterLink } from "react-router-dom";

import {
  AbsenceDiagram,
  Button,
  GapDiagram,
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
  VarianceDiagram,
} from "../design/index.js";

/**
 * WhyAgents — the public route `/why-agents` (DESIGN-SYSTEM §9).
 *
 * The argument page. It answers one question — why send people who do not know your app, rather
 * than write another assertion — and it answers it in four figures with a line under each.
 *
 * **This page was 786 lines of prose and is now a fifth of that.** The previous version ran the
 * retired §9.4 rule ("artefact before explanation") and dramatised this repo's development
 * fixture across five case studies, which is how a marketing page became technical
 * documentation. §9 was rewritten: **the figure comes first, the caption is a line, no page
 * names a fixture.** Every example here is a task app, a booking tool, a CRM or "your app".
 *
 * The order is the argument:
 *
 *  1. the hero — a claim about test suites, not about this product, because the reader already
 *     distrusts claims about this product and does not distrust this one;
 *  2. `#reach` — `ReachDiagram`. One surface drawn twice: the line a suite walks, and where a
 *     population went. The silhouette lands before a word of it is read;
 *  3. `#gap` — `GapDiagram`, and no caption at all. The tool is there, the assertions pass,
 *     nobody found it. That is the class of problem an assertion is structurally unable to hold,
 *     and the figure's own caption is the one that says so;
 *  4. `#limits` — `VarianceDiagram` and four limits at one sentence each;
 *  5. `#absence` — `AbsenceDiagram` and §9.7's honesty clause, set as the second most emphatic
 *     block on the page: full measure, ruled above and below, 48px of air, serif lede, no tint.
 *
 * **The limits keep equal weight**, and that is what makes the page persuasive rather than
 * salesy. §7.3 binds this page exactly as hard as it binds the product: nothing here promises
 * determinism, and a problem absent from the newest execution is an absence, never a repair.
 *
 * **The word "agents"** is the brand's, and `/why-agents` is the carve-out (§9, `MarketingShell`)
 * — the argument is literally about what an autonomous agent does that a scripted assertion
 * cannot. It is spent in the hero and nowhere below it, where the words are the product's:
 * population, cohort, person, visit, execution, finding. Nothing was added to a shared component
 * for this page, so the carve-out reaches no further than this file.
 *
 * **Nothing animates**, which is the strongest way to honour `prefers-reduced-motion`: there is
 * nothing to reduce. **One marked sentence** (§5.4), in `#reach`. No clay, and no forest band —
 * the band appears once on the site, behind the chain diagram (§9.9).
 */

/** The masthead. Space Grotesk 300 at display size (§3.1, named exception 1). */
const MASTHEAD = "Every test you have asserts a path somebody already thought of.";

/** The page's one marked line (§5.4). The argument, in a sentence. */
const THESIS =
  "A population that has never seen your app is the only instrument that finds the paths nobody thought of.";

/**
 * The four limits, one sentence each.
 *
 * `cast` is the fifth line and it is not here, because it is the one thing that *does* hold
 * still — it sits under `VarianceDiagram` as the counterweight rather than in this list.
 */
const LIMITS: readonly { name: string; body: string }[] = [
  {
    name: "Outcomes vary, by design",
    body: "Two executions of one simulation produce different prose, different counts and different costs. There is no determinism setting, and there will not be one.",
  },
  {
    name: "An absence is not a repair",
    body: "A problem that stops being reported may be gone, or may have been described in different words this time. Whether it is fixed is your call.",
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
              and stops. A third paragraph restating both stood here and was the weakest of the
              three printings of one idea.
            */}
            <ReachDiagram size="hero" />

            <Measure as="p" width="statement">
              <Text size="statement" tone="ink" as="span" marked>
                {THESIS}
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- THE INVISIBLE CLASS OF PROBLEM ------------------------------------------ */}
        <Section id="gap" title="The tool is there. Nobody finds it.">
          {/*
            The figure alone (§9.3). `GapDiagram` draws its own generic example — a reporting
            export, which a task app, a booking tool and a CRM all plausibly have — and its own
            caption already lands the punch line: *a test calls the tool directly; a person has to
            find it first, and finding it is the step no assertion takes.* The page paragraph that
            stood here said that back in different words, which made this the fourth section on
            the site to print one idea twice.
          */}
          <GapDiagram size="hero" />
        </Section>

        {/* The hinge. The case is above it; what it costs you is below. One rule on the page. */}
        <SectionRule glyph="dots" count={3} />

        {/* ---- THE LIMITS -------------------------------------------------------------- */}
        <Section id="limits" title="What it will not do for you" trailing="4 limits">
          <Stack gap={8} align="start">
            <VarianceDiagram size="hero" />

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
          </Stack>
        </Section>

        {/* ---- THE HONESTY CLAUSE ------------------------------------------------------ */}
        <Section id="absence" title="A problem that stops being reported">
          <Stack gap={8} align="start">
            <AbsenceDiagram size="hero" />

            {/*
              §9.7's treatment, verbatim: full measure, a rule above and below, 48px of air, serif
              lede, no icon and no tint. It is the second most emphatic block on the page, and it
              is a limit rather than a feature — which is the point of giving it that weight.
            */}
            <div className="w-full">
              <Separator />
              <div className="py-12">
                <Measure as="p" width="lede">
                  <Text size="lede" tone="ink" as="span">
                    Executions vary by design. A problem that stops appearing is reported as an
                    absence, not a repair. Whether it is fixed is your call, and there is a field
                    to record it in.
                  </Text>
                </Measure>
              </div>
              <Separator />
            </div>
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
