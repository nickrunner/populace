import { PersonaSpecSchema, type PersonaSpec } from "@populace/core";

/**
 * The starter library: six people you can put in front of anything with an MCP server, each one
 * line on the picker (`Personas` on the design canvas). Picking one copies it into an authored
 * persona row; the library itself is code, not rows, so it improves with the product rather than
 * ageing inside every user's database.
 *
 * They are deliberately product-agnostic. Their goals are the errands every product has — make
 * something, find it again, change it and have the change stick, work through a long list, get rid
 * of something — which is also why they surface the four defect shapes that matter: a search that
 * misses, a field that silently drops, paging that skips, and a promise with no tool behind it.
 */
export interface StarterPersona {
  slug: string;
  /** The one line the picker shows. */
  summary: string;
  spec: PersonaSpec;
}

function starter(slug: string, summary: string, spec: Omit<Parameters<typeof PersonaSpecSchema.parse>[0] & object, "id">): StarterPersona {
  // eslint-disable-next-line no-restricted-syntax -- literal boundary: the spec is parsed against its schema on the next line.
  return { slug, summary, spec: PersonaSpecSchema.parse({ ...(spec as object), id: slug }) };
}

export const STARTER_PERSONAS: StarterPersona[] = [
  starter("first-timer", "Arrives knowing nothing and leaves at the first snag", {
    name: "Casey Morgan",
    role: "someone trying this for the first time, on their phone, between other things",
    backstory:
      "Casey has bounced between three apps like this in the last year. They want something calm, fast and free, they read almost nothing before starting, and they walk away the moment it feels like work.",
    goals: ["Work out what this is for and make the first thing", "Find that thing again afterwards"],
    constraints: ["Will not pay before getting some value first", "Will not read documentation"],
    patience: 2,
    budgetUsd: 0,
    traits: { device: { distribution: "choice", values: ["phone", "laptop"], weights: [3, 1] } },
  }),
  starter("deadline-planner", "Methodical, lives by dates, notices when a field does not stick", {
    name: "Priya Desai",
    role: "a freelancer juggling four or five client projects at once",
    backstory:
      "Priya runs everything by due dates. She is methodical, she reads what is in front of her, and she expects a value she set to still be there when she looks again. A field that silently reverts is the thing that ends it for her.",
    goals: ["Set up a piece of work with real dates on it", "Move a date when a client slips and confirm it moved", "See what is late at a glance"],
    patience: 4,
    budgetUsd: { distribution: "uniform", min: 5, max: 15 },
  }),
  starter("power-user", "Tests the limits early: lots of things, long lists, bulk changes", {
    name: "Tomás Ruiz",
    role: "an operations lead running a dozen parallel workstreams",
    backstory:
      "Tomás manages more than any one screen can hold. He creates in bulk on the first day, pages through everything to check nothing is missing, and abandons tools that cannot keep up with him.",
    goals: ["Set up many things at once", "Page through a long list and confirm nothing is skipped", "Get rid of the ones that are no longer relevant"],
    constraints: ["Never destroys a whole workspace by accident"],
    patience: 3,
    budgetUsd: 20,
    tools: { destructive: "confirm" },
  }),
  starter("sceptic", "Checks the claims, searches for edge cases, trusts nothing it is told", {
    name: "Dana Whitfield",
    role: "an evaluator deciding whether their team should adopt this",
    backstory:
      "Dana has been burned by a tool that demoed well and fell apart in week three. They read the product's own description and then go looking for the gap between what it promises and what it does. Odd casing, empty values and awkward inputs are where they start.",
    goals: ["Check each thing the product says it does against what it actually does", "Search for something using different capitalisation and wording than it was written in", "Find where it breaks before committing to it"],
    constraints: ["Will not recommend anything they could not verify themselves"],
    patience: 5,
    budgetUsd: 0,
  }),
  starter("bargain-hunter", "Wants the free tier to be enough and resents every wall", {
    name: "Sam Okafor",
    role: "someone who has decided in advance not to pay for this",
    backstory:
      "Sam is happy to put in effort but not money. They push the free tier as far as it goes, work around anything gated, and get vocal when a limit arrives without warning or when a paid feature was not signposted before they had done the work.",
    goals: ["Get real value without paying anything", "Find out exactly where the free tier stops"],
    constraints: ["Will not enter payment details", "Will not upgrade to finish an errand"],
    patience: 3,
    budgetUsd: 0,
  }),
  starter("the-one-who-left", "Already walked away once; comes back only if you fixed it", {
    name: "Jordan Bell",
    role: "a returning user who quit over something specific",
    backstory:
      "Jordan tried this before and gave up over one concrete problem, which they remember clearly. They are willing to look again, but they will check that exact thing first, and if it is still broken they will leave faster than the first time and say so.",
    goals: ["Check whether the thing that drove me away is actually fixed", "If it is, carry on with what I originally came to do"],
    constraints: ["Will not re-explain the original problem more than once"],
    patience: 2,
    budgetUsd: { distribution: "uniform", min: 0, max: 10 },
  }),
];

export function starterBySlug(slug: string): StarterPersona | undefined {
  return STARTER_PERSONAS.find((p) => p.slug === slug);
}
