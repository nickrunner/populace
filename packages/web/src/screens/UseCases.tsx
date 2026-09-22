import { Link as RouterLink } from "react-router-dom";

import {
  Button,
  CoverageDiagram,
  GapDiagram,
  Heading,
  Inline,
  MarketingShell,
  Measure,
  Section,
  Stack,
  Text,
  VarianceDiagram,
  VisitDiagram,
} from "../design/index.js";

/**
 * UseCases — the public route `/use-cases`, set in `MarketingShell`.
 *
 * **This page opens on a result, not on an argument.** It used to open on `ReachDiagram` — the
 * same figure, at the same size, carrying the same built-in sentence, that `/why-agents` opens
 * on. Two of the site's five pages shared their entire first scroll, and a reader who visited
 * both learned nothing the second time. `ReachDiagram` belongs to `/why-agents`, where the
 * suite-versus-population contrast is the whole thesis; this page is about what you actually get
 * back, so it opens on `GapDiagram` — twelve people wanted a capability that exists, none of them
 * arrived at it — which is a reading rather than a claim.
 *
 * **Nothing on this page appears on `/why-agents`.** The two pages now share no figure and no
 * sentence. `GapDiagram`, `CoverageDiagram`, `VisitDiagram` and `VarianceDiagram` are this page's
 * four; `ReachDiagram` and `AbsenceDiagram` are that page's two.
 *
 * The rest is DESIGN-SYSTEM §9.3 and §9.4 taken literally:
 *
 *  - **A figure opens every section**, and the prose under it is a blurb, not an essay. The
 *    figures in `brand/diagrams/` already explain these mechanisms better than a paragraph does.
 *  - **Nothing is named that a stranger would have to learn.** The examples are shapes — a
 *    capability, a description, a first visit, a second execution — and the tool names inside the
 *    figures are generic by construction (`export_report`, `create_item`, `search`).
 *  - **Every figure here is drawing its own example**, so every one of them prints the word
 *    *illustrative* in its own header. That is `DiagramFigure`'s `sample` flag, computed from
 *    whether a data prop was passed, which is why this file passes none. **No number on this
 *    page is a measurement, and none is offered as one.**
 *
 * **The honesty is a section and not a footnote** (§7.3, §9.7). `VarianceDiagram` carries
 * `EXECUTIONS_ARE_INDEPENDENT` itself — a constant in `Figure.js`, not a prop — so the page
 * cannot ship a gentler wording of it, and the marked phrase beneath it is the page's one lime
 * band, spent on the rule rather than on a boast.
 *
 * **Vocabulary.** The `/why-agents` carve-out is not spent here: this page is about what *people*
 * ran into in a product, and the product's own word for one of them is *person*.
 */

/** The page's one marked phrase (§5.4). What a second execution is, and what it is not. */
const TWO_READINGS = "Two executions are two readings, not a before and after.";

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
            The opening is the first case, drawn: a capability that is there, that works, and that
            nobody reached. It is the page's own figure — `/why-agents` opens on `ReachDiagram`
            and shows this one nowhere — and its built-in caption is the figure speaking, not the
            page, which is why no blurb follows it.
          */}
          <GapDiagram size="hero" className="w-full" />
        </Stack>

        {/* ---- 1. A PROMISE WITH NOTHING BEHIND IT ------------------------------------- */}
        <Section id="promises" title="The copy promises something the product cannot do">
          <Stack gap={6} align="start">
            {/*
              `CoverageDiagram`'s own example surface carries one capability that is promised and
              not exposed, which is the whole scenario — so the figure is the argument and the
              blurb underneath is two sentences of framing. Its middle band, the tools nobody
              touched, is the hero figure read at the scale of a whole surface.
            */}
            <CoverageDiagram size="hero" className="w-full" />
            <Blurb>
              Your landing page, your docs and your tool descriptions all make promises. A
              population reads them, goes looking, and files what it could not find.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- 2. THE FIRST VISIT ------------------------------------------------------ */}
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

        {/* ---- 3. READING A SECOND EXECUTION ------------------------------------------- */}
        <Section id="across-executions" title="Reading a second execution">
          <Stack gap={6} align="start">
            {/*
              The figure first, and the rule after it. `VarianceDiagram` draws one simulation sent
              in twice — the rows both executions reported, and the rows only one of them reached
              — and prints §7.3's `EXECUTIONS_ARE_INDEPENDENT` from `Figure.js` rather than from a
              prop, so no call site can soften it.
            */}
            <VarianceDiagram size="hero" className="w-full" />

            {/*
              The page's one marker band (§5.4), at the lede measure rather than the statement
              measure: `ch` resolves against the box's own font, and 34ch of this step would orphan
              the phrase's last word inside a lime band.
            */}
            <Measure as="p" width="lede">
              <Text size="statement" tone="ink" as="span" marked>
                {TWO_READINGS}
              </Text>
            </Measure>

            <Blurb>
              Send the same simulation in again and the people do different things with it. What
              both executions reported is where to start; what only one of them reached is the edge
              of what got covered, and neither is a score.
            </Blurb>
          </Stack>
        </Section>

        {/* ---- THE CLOSE --------------------------------------------------------------- */}
        <Section id="start" title="Start one">
          <Stack gap={6} align="start">
            <Blurb>
              Point a population at any app that exposes an MCP server and give it an errand. The
              first digest tells you which of these you have.
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
