import { Link as RouterLink } from "react-router-dom";
import type { ClusterCardView, ToolCallRecord } from "@populace/contract";

import {
  Button, CallRef, ChainDiagram, cn, EXECUTIONS_ARE_INDEPENDENT, ExplorationFan, FindingCard,
  Heading, Inline, LANDING_PANEL, Link, Logo, MarketingShell, Measure, PayloadBlock, ReachDiagram,
  Section, Separator, Stack, StepStrip, Text, ToolName,
} from "../design/index.js";
import type { FanEnd } from "../design/index.js";

/**
 * Landing — the public route, `/`.
 *
 * **Rewritten to be a marketing page rather than a specification** (DESIGN-SYSTEM §9, as
 * amended). It ran to 837 lines, and three things were wrong with it. It named this repo's
 * development fixture seven times — a fixture is how the harness is built, not a product
 * feature, and the name now appears on none of the five public pages (§9.4). It presented
 * authored counts as a reading — nothing here is a measurement, so the one finding below is
 * labelled illustrative on its own section rule (§9.6). And it explained in prose what a figure
 * already draws — twelve figures existed and were buried three paragraphs deep. **No paragraph
 * here restates the figure above it**: `#how-it-works` is `StepStrip` and then the forest band,
 * and `#why` is `ReachDiagram` with a one-line caption, because a strip whose beats are already
 * sentences does not need those sentences printed again underneath it (§9.3).
 *
 * **The order is the argument**: what it is → how it works → why a population rather than a
 * suite → what comes back → what it will not tell you → start. Five sections, one graphic each,
 * under four hundred words of body copy, every example generic.
 *
 * **No spine, and no stub column** (§9.2): `MarketingShell` no longer draws one and nothing here
 * indents to `--w-stub`. The earlier version hung every block off a 72px stub, which is what put
 * a hairline through each section heading. **One orchestrated motion**, the hero fan drawing
 * itself; `brand/Fan` holds its last frame under `prefers-reduced-motion`, in CSS.
 */

/**
 * The masthead. The brand kit's approved line is *"See your app through agents' eyes."*, and
 * "agent" is a word the product's interface may never print (§7.2). A human who wants the kit's
 * wording back changes this constant and nothing else.
 */
const MASTHEAD = "See your app through your users' eyes.";

/** The descriptor, verbatim from the brand kit and from §7.2. Not to be reworded. */
const DESCRIPTOR = "Autonomous testing for MCP apps.";

/**
 * The hero fan's nine endings, interleaved so the three outcomes do not read as three stacked
 * blocks. One end per outcome carries a word, because the legend is built from the first
 * labelled end of each — and because **the word is the licence for clay**: `gaveUp` is drawn in
 * `--pop-clay` only where its label sits beside it (§4.1, §9.3).
 */
const HERO_ENDS: readonly FanEnd[] = [
  { outcome: "filed", label: "filed a problem" },
  { outcome: "done", label: "got their errand done" },
  { outcome: "filed" },
  { outcome: "gaveUp", label: "gave up" },
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "gaveUp" },
  { outcome: "filed" },
];

/**
 * **The example finding — illustrative, and the section rule says so.** A search that promises a
 * case-insensitive match and delivers a case-sensitive one is a shape any app can have; no
 * number here was counted off anything (§9.6). The shape is `ClusterCardView` as it arrives on
 * the wire, so `FindingCard` does here what it does on `SimulationResults`. The timestamps are
 * relative to load: a frozen ISO string would drift into "8 months ago" (§4.5).
 */
const HOUR = 60 * 60 * 1000;
const FIRST_SEEN = new Date(Date.now() - 51 * HOUR).toISOString();
const LAST_SEEN = new Date(Date.now() - 2 * HOUR).toISOString();

const FINDING: ClusterCardView = {
  signature: "sig1:4f2a91c7be03",
  title: "Searching in lower case finds nothing",
  severity: "high",
  kind: "bug",
  tool: "search",
  verdict: "confirmed",
  peopleHit: 9,
  peopleTotal: 12,
  reports: 14,
  cohorts: [
    { slug: "first-timers", name: "First-timers", hit: 5, total: 6 },
    { slug: "power-users", name: "Power users", hit: 4, total: 6 },
  ],
  state: "open",
  seenIn: [1, 2, 3],
  firstSeenAt: FIRST_SEEN,
  lastSeenAt: LAST_SEEN,
  triage: null,
};

/**
 * The reproduction steps as `ToolCallRecord`s — what the verifier replays, keyed by the refs the
 * person cited in `file_finding` (ADR-0015, §4.3). The card prints the seam; the wells below
 * print what `c4` sent and what came back.
 */
const EVIDENCE: readonly ToolCallRecord[] = [
  {
    ref: "c3",
    endpoint: "https://api.example.com/mcp",
    tool: "create_item",
    arguments: { title: "Buy Groceries" },
    result: { text: '{"id":"itm_3a1","title":"Buy Groceries"}', isError: false },
    latencyMs: 41,
    traceSeq: 18,
    at: LAST_SEEN,
  },
  {
    ref: "c4",
    endpoint: "https://api.example.com/mcp",
    tool: "search",
    arguments: { query: "groceries", limit: 20 },
    result: { text: '{"results":[],"total":0}', isError: false },
    latencyMs: 29,
    traceSeq: 21,
    at: LAST_SEEN,
  },
  {
    ref: "c5",
    endpoint: "https://api.example.com/mcp",
    tool: "search",
    arguments: { query: "Groceries", limit: 20 },
    result: { text: '{"results":[{"id":"itm_3a1","title":"Buy Groceries"}],"total":1}', isError: false },
    latencyMs: 27,
    traceSeq: 24,
    at: LAST_SEEN,
  },
];

const SENT = JSON.stringify(EVIDENCE[1]?.arguments ?? null);
const CAME_BACK = EVIDENCE[1]?.result.text ?? "";

/**
 * The page's one inverted band, and the only place dark `accent` is a ground (§9.9). Forest is
 * `primary` in light and `accent` in dark — one colour under two token names — so the flip is
 * two `dark:` utilities and nothing here asks TypeScript what the theme is.
 */
const FOREST = "bg-primary dark:bg-accent";
const ON_FOREST = "text-on-primary dark:text-on-accent";

export function Landing() {
  return (
    <MarketingShell>
      <Stack gap={12}>
        {/* ---- THE HERO --------------------------------------------------------------- */}
        <Stack gap={6} align="start">
          <div>
            {/* Adjacent siblings: §3.7's `.t-eyebrow + .t-masthead` rule owns the 24px between
                them, trimmed to cap-top so the gap is a measurement. */}
            <Text as="p" size="eyebrow" tone="muted">
              {DESCRIPTOR}
            </Text>
            <Heading level={1} size="masthead">
              {MASTHEAD}
            </Heading>
          </div>

          <Measure as="p" width="lede">
            <Text size="lede" tone="soft" as="span">
              A population of AI people arrives at your app through its MCP server knowing
              nothing, finds its own way around, and files what stopped them.
            </Text>
          </Measure>

          <Inline gap={3} align="center" wrap>
            <Button asChild variant="primary" size="lg">
              <RouterLink to="/app">Point it at your app</RouterLink>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </Inline>

          {/*
            Two instances, one per breakpoint: `Fan` names its ends only at `hero`, over a
            1140-unit viewBox, so on a phone those labels would land under 5px. Below `md` the
            picture drops to `panel`, where no end is named, the legend still says all three, and
            `gaveUp` falls back to `left` ink because clay's one condition is no longer met. The
            hidden instance leaves the accessibility tree, so the sentence is announced once.
          */}
          <div className="w-full pt-2">
            <div className="hidden md:block">
              <ExplorationFan ends={HERO_ENDS} size="hero" animate />
            </div>
            <div className="md:hidden">
              <ExplorationFan ends={HERO_ENDS} size="panel" animate />
            </div>
          </div>
        </Stack>

        {/* ---- HOW IT WORKS ----------------------------------------------------------- */}
        <Section id="how-it-works" title="How it works" trailing="five beats">
          <Stack gap={8}>
            {/* The mechanism, in one graphic, and nothing under it. The strip's third beat is
                already titled "They try to get something done" over the note "no script, no
                tour" — so the paragraph that used to sit here printed two of the strip's own
                captions back at the reader as prose (§9.3). */}
            <StepStrip />

            {/* The page's one inverted band. The chain is the product's vocabulary drawn rather
                than listed — seven words a reader has not met, each with its shape and its
                relation to the one before it. `detail="compact"` leaves the definitions to
                `/concepts`. */}
            <div className={cn(FOREST, ON_FOREST, LANDING_PANEL, "relative p-6 md:p-10")}>
              <Stack gap={8}>
                <Logo size="lg" on="forest" label={null} />
                <ChainDiagram on="forest" detail="compact" size="hero" />
                {/* The caption, under the picture it captions (§9.3). It used to sit above the
                    chain, where it asked the reader to take on trust the thing the next graphic
                    was about to draw. */}
                <Measure as="p" width="lede">
                  <Text size="statement" tone="on-primary" as="span" className="dark:text-on-accent">
                    Give it a target and a few kinds of person. It gives you back what went wrong,
                    and the calls that prove it.
                  </Text>
                </Measure>
              </Stack>
            </div>

            {/* Outside the band: `Link` takes its ink from `--c-link`, and the forest ground
                republishes the text tokens but not that one. */}
            <Measure as="p" width="read">
              <Text size="read" tone="soft" as="span">
                <Link to="/how-it-works">How it works</Link> follows one visit end to end, and{" "}
                <Link to="/concepts">the vocabulary</Link> says what each of those seven words
                owns.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- WHY A POPULATION ------------------------------------------------------- */}
        <Section id="why" title="Why a population">
          {/* The argument, in one graphic. Its own lede states the case; the caption is the
              consequence, and it is one line. */}
          <ReachDiagram
            size="hero"
            caption={
              <Text as="p" size="read" tone="ink">
                The problems that cost you are in the part of the surface nobody thought to
                assert.
              </Text>
            }
          />
        </Section>

        {/* ---- WHAT COMES BACK -------------------------------------------------------- */}
        <Section id="a-finding" title="What comes back" trailing="illustrative">
          <Stack gap={6}>
            {/* The page's strongest moment, and the only place it spends this much room: a real
                `FindingCard`, with the real evidence seam and the real payload wells under it. */}
            <FindingCard
              cluster={FINDING}
              evidence={EVIDENCE}
              quote={{
                name: "Dana Whitlock",
                words:
                  "I made that ten seconds ago. If search cannot find it, I am not going to trust the list either.",
                visit: 2,
              }}
            />

            {/* One step of the seam opened up — the same well the transcript and the finding
                page draw, with the same 2px evidence edge (§4.3). */}
            <Stack gap={3}>
              <Inline gap={2} align="baseline" wrap>
                <CallRef callRef="c4" />
                <ToolName name="search" />
                <Text size="meta" tone="muted">
                  the call the verifier replayed
                </Text>
              </Inline>
              <div className="grid gap-4 lg:grid-cols-2">
                <PayloadBlock caption="what they sent" value={SENT} />
                <PayloadBlock caption="what came back" value={CAME_BACK} />
              </div>
            </Stack>

            <Measure as="p" width="read">
              <Text size="read" tone="soft" as="span">
                An example, not a measurement — but not a mock-up either. This is the finding
                view, rendered by the components the dashboard renders.
              </Text>
            </Measure>
          </Stack>
        </Section>

        {/* ---- WHAT IT WILL NOT TELL YOU ---------------------------------------------- */}
        {/* §9.7: a section rather than a footnote, and the second most emphatic block after the
            masthead. Full measure, a rule above and below, serif at the lede step, no icon and no
            tint. The absence rule is word for word: the other reading — that a problem which
            stopped appearing has been fixed — is the one expensive mistake this page could
            teach. */}
        <Section id="limits" title="What it will not tell you">
          <div className="py-6 md:py-12">
            <Stack gap={6} align="start">
              <Measure as="p" width="lede">
                <Text size="lede" tone="ink" as="span">
                  {EXECUTIONS_ARE_INDEPENDENT}
                </Text>
              </Measure>
              <Measure as="p" width="lede">
                <Text size="lede" tone="ink" as="span">
                  A problem that stops appearing is reported as an absence, not a repair. Whether
                  it is fixed is your call, and there is a field to record that you made it.
                </Text>
              </Measure>
              <Measure as="p" width="read">
                <Text size="read" tone="soft" as="span">
                  There is no determinism setting, and there will not be one.{" "}
                  <Link to="/why-agents">The case for sending people in</Link> sets out all four
                  limits at the same weight as the argument.
                </Text>
              </Measure>
            </Stack>
          </div>
          <Separator />
        </Section>

        {/* ---- START ------------------------------------------------------------------ */}
        <Section id="start" title="Start">
          <Stack gap={6} align="start">
            <Measure as="p" width="lede">
              <Text size="lede" tone="soft" as="span">
                Point it at any MCP server. The dashboard prices a run before it spends anything,
                and sweeps up the accounts it created afterwards.
              </Text>
            </Measure>
            <Button asChild variant="primary" size="lg">
              <RouterLink to="/app">Open the dashboard</RouterLink>
            </Button>
          </Stack>
        </Section>
      </Stack>
    </MarketingShell>
  );
}
