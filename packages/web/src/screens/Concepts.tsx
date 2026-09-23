import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import {
  AN_ABSENCE_ONLY,
  Button,
  Capsule,
  CHAIN_LINKS,
  ChainDiagram,
  cn,
  Code,
  CompositionDiagram,
  Dot,
  EXECUTIONS_ARE_INDEPENDENT,
  Heading,
  Inline,
  LANDING_PANEL,
  Lattice,
  MarketingShell,
  Measure,
  ornamentSurface,
  PersonDiagram,
  Ring,
  Section,
  SectionRule,
  Separator,
  Stack,
  Text,
} from "../design/index.js";
import type { ChainLink, LatticeDot } from "../design/index.js";

/**
 * Concepts — the public route `/concepts`, and the product's dictionary.
 *
 * **The definition lives in exactly one place, and this page is it.** The previous version drew
 * `ChainDiagram` at `detail="full"` — a sentence per link — and then printed seven of the same
 * sentences underneath as `Section`s; `finding` was word for word identical in both. The fix is
 * structural rather than editorial:
 *
 *  - **The figure is the map.** `detail="compact"` draws shape, name and what each link does to
 *    the next, and every row links into this page's own anchor. The seven links are the index, so
 *    the hairline jump nav under the masthead is gone: the picture does that job.
 *  - **The page is the dictionary.** One `<dl>`, eight entries, each a mark-grammar glyph, a
 *    headword and *one* line. The glyph is what keeps the line to one — a stadium already says
 *    "cohort" and a lattice already says "population" (§8.6). A third sentence about a term would
 *    mean the glyph is not working.
 *
 * `CompositionDiagram` and `PersonDiagram` carry their own band sentences, so those two sections
 * add no prose either. Nothing here restates a figure.
 *
 * **What this page may never do** (§7.3, ADR-0028/0030): promise a repeatable outcome. A
 * dictionary is the most tempting place to imply it, because *"the same cohorts make the same
 * people"* is true and sits one clause from *"so you get the same answer"*, which is false.
 * `#what-varies` bounds it in the constants the figures carry. `person` is careful for the same
 * reason: people are stable because **the row is stored**, not because a seed is repeatable
 * (ADR-0031).
 */

/** The landing's forest, spelled the way the landing spells it: `primary` in light, `accent` in dark. */
const FOREST = "bg-primary dark:bg-accent";

/** A container — a scope you author inside, or a thing you press go on. Not people, so not a mark. */
const FRAME = "inline-flex items-center justify-center rounded-md border border-rule-strong";

/** Illustrative people. They stand for a shape rather than for anyone, so they carry no name. */
function crowd(count: number): LatticeDot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    state: "present" as const,
    label: "one person",
  }));
}

/** The eight headwords: the seven chain links, in order, and the one word that is not a link. */
type Term = ChainLink | "execution";

const TERMS: readonly Term[] = [...CHAIN_LINKS.slice(0, 6), "execution", ...CHAIN_LINKS.slice(6)];

/**
 * The answer, in one line. **This is the only place a definition is written.** The figure above
 * draws the shape and the relation and links here; nothing restates these sentences.
 */
const DEFINITIONS: Record<Term, ReactNode> = {
  project: "Everything you author about one app. Nothing is shared between two projects.",
  simulation: "A population, a target and a mode. It is the thing you press go on.",
  population: "Which cohorts go, and how many of each. Setting the number is what makes the people.",
  cohort: (
    <>
      People who share a condition — what they have in common, in their own words — drawn from a
      mix of personas in a ratio. It owns the seed and how often its people come back, and no
      headcount (<Code inProse>size</Code> is the population&rsquo;s).
    </>
  ),
  person: "A durable individual: a name, a line, and whatever you set on them by hand. Written once, never silently rewritten.",
  visit: "One session: someone arrives, tries to get an errand done, and leaves.",
  execution: "One run of a simulation, numbered from one. It holds that run’s visits.",
  finding: "One problem, carrying the calls it rests on, so a verifier can replay it.",
};

/**
 * Each word's shape, in the mark's own grammar (§8.6) — which is the whole reason a definition
 * here fits on one line. `project`, `simulation` and `execution` are frames rather than people,
 * and are drawn as frames; inventing a brand glyph for them would say "cohort" about something
 * that is not one.
 */
function glyphOf(term: Term): ReactNode {
  switch (term) {
    case "project":
      return (
        <span className={cn(FRAME, "p-1")}>
          <span className={cn(FRAME, "h-4 w-6 border-rule")} />
        </span>
      );
    case "simulation":
      return (
        <span className={cn(FRAME, "p-1")}>
          <Lattice dots={crowd(6)} rows={2} size="sm" />
        </span>
      );
    case "population":
      return <Lattice dots={crowd(12)} rows={4} size="sm" />;
    case "cohort":
      return <Capsule cells={5} size="sm" />;
    case "person":
      return <Dot state="present" size="lg" />;
    case "visit":
      return (
        <span className="inline-flex items-center gap-1">
          <Dot state="present" size="sm" />
          <Separator weight="provisional" className="w-3" />
          <Ring size="sm" />
        </span>
      );
    case "execution":
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className={cn(FRAME, "h-3 w-3 border-rule")} />
          <span className={cn(FRAME, "h-3 w-3 border-rule")} />
          <span className={cn(FRAME, "h-3 w-3")} />
        </span>
      );
    case "finding":
      return <Dot state="theOne" size="lg" />;
  }
}

/**
 * One entry, as `<dl>` wants it: a `div` child holding the pair, so `dt` and `dd` stay legal
 * children. The headword is the term, sentence case — it is a name (§3.1) — and the glyph spans
 * both rows in the locator column, `aria-hidden` because it is the definition drawn and a screen
 * reader already has that in words. `id` is the anchor: `/concepts#cohort`.
 */
function Word({ term }: { term: Term }): ReactNode {
  return (
    <div id={term} className="grid scroll-mt-6 grid-cols-[2.75rem_1fr] gap-x-3">
      <span aria-hidden="true" className="row-span-2 flex items-start justify-start pt-1">
        {glyphOf(term)}
      </span>
      <Text as="dt" size="name" className="min-w-0">
        {term.charAt(0).toUpperCase() + term.slice(1)}
      </Text>
      <Text as="dd" size="read-sm" tone="soft" className="min-w-0">
        {DEFINITIONS[term]}
      </Text>
    </div>
  );
}

/** Every chain row is a way into this page's own entry, which is what retired the jump nav. */
const CHAIN_HREFS: Partial<Record<ChainLink, string>> = Object.fromEntries(
  CHAIN_LINKS.map((link) => [link, `#${link}`]),
);

export function Concepts() {
  return (
    <MarketingShell>
      <Stack gap={12}>
        <Stack gap={6} align="start">
          {/* Adjacent siblings: §3.7's `.t-eyebrow + .t-masthead` rule owns the 24px. */}
          <div>
            <Text as="p" size="eyebrow" tone="muted">
              The vocabulary
            </Text>
            <Heading level={1} size="masthead">
              Eight words, and the chain they make.
            </Heading>
          </div>

          <Measure as="p" width="lede">
            <Text size="lede" tone="soft" as="span">
              Read the chain, or take the word that sent you here.
            </Text>
          </Measure>
        </Stack>

        {/*
          §9.9's single forest band. `ornamentSurface` republishes the system's tokens for this
          ground, so everything inside is correct without a `dark:` utility here and without asking
          TypeScript what the theme is. `compact` is the anti-duplication decision: the figure draws
          the shape, the name and the relation, and hands the sentence to the entry it links to.
        */}
        <Section id="the-chain" title="The chain" trailing="seven links, each one a way in">
          <div
            className={cn(FOREST, ornamentSurface({ on: "forest" }), LANDING_PANEL, "p-6 md:p-10")}
          >
            <ChainDiagram size="hero" on="forest" detail="compact" hrefs={CHAIN_HREFS} />
          </div>
        </Section>

        <Section id="vocabulary" title="The eight words" trailing="a shape, a word, a line">
          <dl className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            {TERMS.map((term) => (
              <Word key={term} term={term} />
            ))}
          </dl>
        </Section>

        {/* The one ornamented rule, on the page's one hinge: words end, figures begin. */}
        <SectionRule glyph="capsule" />

        {/* Both figures carry their own name, lede and band sentences, so the section is an
            address and nothing more — a title that restated the figure would be the very
            duplication this rebuild removed. */}
        <Section id="composition" title="Composition">
          <CompositionDiagram size="hero" />
        </Section>

        <Section id="modes" title="Ephemeral and longitudinal" trailing="the two modes">
          <PersonDiagram size="hero" mode="both" />
        </Section>

        {/* §9.7: a section, not a footnote — and the clauses are the figures' own constants. */}
        <Section id="what-varies" title="What varies, and what does not">
          <Stack gap={6} align="start">
            <Measure as="p" width="statement">
              <Text size="statement" tone="ink" as="span" marked>
                Composition is fixed. What people do with it is not.
              </Text>
            </Measure>

            <Measure as="p" width="lede">
              <Text size="lede" tone="ink" as="span">
                {EXECUTIONS_ARE_INDEPENDENT} {AN_ABSENCE_ONLY}
              </Text>
              <Text size="lede" tone="soft" as="span">
                {" "}
                Whether it is fixed is your call, and there is a field to record that you made it.
              </Text>
            </Measure>
          </Stack>
        </Section>

        <Section id="start" title="Start" trailing="none of it typed by hand">
          <Stack gap={6} align="start">
            <Measure as="p" width="lede">
              <Text size="lede" tone="soft" as="span">
                Adopting a starter persona builds the cohort, the population and the people for you.
                These words are for the day you want to change one.
              </Text>
            </Measure>

            <Inline gap={3} align="center" wrap>
              <Button asChild variant="primary" size="lg">
                <RouterLink to="/app">Open the dashboard</RouterLink>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <RouterLink to="/projects">Your projects</RouterLink>
              </Button>
            </Inline>
          </Stack>
        </Section>
      </Stack>
    </MarketingShell>
  );
}
