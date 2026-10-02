import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validate } from "./commands.js";
import { loadConfig } from "./config.js";

const head = `version: 2
target:
  name: Tasklet
  mcp:
    - name: default
      url: http://127.0.0.1:4999/mcp
identity:
  strategy: none
population:
  id: pop
  name: Everyone
`;

/** Two cohorts of two and one: the file's lane counts add up to three. */
const cohorts = `cohorts:
  - slug: casual
    context: You keep lists on your phone.
    size: 2
    persona:
      id: casual
      name: Casual
      role: a hobbyist with lists
      backstory: They keep grocery lists.
      goals: [keep a list]
  - slug: planners
    context: You plan client work.
    size: 1
    persona:
      id: planner
      name: Planner
      role: a freelancer with deadlines
      backstory: They live by due dates.
      goals: [track a launch]
`;

function fileWith(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "populace-config-"));
  const path = join(dir, "populace.yaml");
  writeFileSync(path, body);
  return path;
}

describe("loadConfig", () => {
  /**
   * ADR-0041: the study is the only headcount, and a CLI run is a study too. The daemon runs the
   * file's lane counts, so their sum is the size the snapshot records — a file with no plan at all
   * still says how many went, rather than the schema's nought.
   */
  it("sets the study's size to the sum of the cohorts' counts, plan or no plan", () => {
    const bare = loadConfig(fileWith(`${head}${cohorts}`));
    expect(bare.simulations).toEqual([]);
    expect(bare.config.simulation.size).toBe(3);
    expect(bare.config.simulation.brief).toBe("");

    // A mix deals its cohort's size across the personas, and the counts still add up to the size.
    const mixed = loadConfig(
      fileWith(`${head}cohorts:
  - slug: mixed
    context: You share a condition.
    size: 4
    mix:
      - weight: 3
        persona: { id: a, name: A, role: r, backstory: b, goals: [g] }
      - weight: 1
        persona: { id: b, name: B, role: r, backstory: b, goals: [g] }
`),
    );
    expect(mixed.config.population.members.map((member) => member.count)).toEqual([3, 1]);
    expect(mixed.config.simulation.size).toBe(4);
  });

  /**
   * ADR-0042: the file may call the block by the product's word. A plan's `size` rides through to
   * the importer, and does NOT change what the CLI runs: the daemon's size is still the counts.
   */
  it("accepts `studies:` as `simulations:`, carries a plan's size to the import, and runs the counts", () => {
    const loaded = loadConfig(
      fileWith(`${head}studies:
  - slug: trial
    name: Tasklet trial
    mode: ephemeral
    visitsPerPerson: 3
    size: 9
${cohorts}`),
    );
    expect(loaded.simulations).toHaveLength(1);
    expect(loaded.simulations[0]).toMatchObject({ slug: "trial", name: "Tasklet trial", visitsPerPerson: 3, size: 9 });
    expect(loaded.config.simulation.slug).toBe("trial");
    expect(loaded.config.simulation.mode).toBe("ephemeral");
    expect(loaded.config.simulation.size).toBe(3);
  });

  it("names an unnamed study by the product's word, and leaves size off a plan that gave none", () => {
    const loaded = loadConfig(fileWith(`${head}simulations:\n  - mode: longitudinal\n${cohorts}`));
    expect(loaded.simulations[0]?.slug).toBe("study-1");
    expect(loaded.simulations[0]).not.toHaveProperty("size");
  });

  /** Two lists whose first entries each claim to be the plan is a guess, and ADR-0035 says not to guess. */
  it("refuses a file that writes both `studies:` and `simulations:`", () => {
    expect(() => loadConfig(fileWith(`${head}studies: []\nsimulations: []\n${cohorts}`))).toThrow(/same block/);
  });

  /**
   * ADR-0045: the report cycle is how often a running study stops to report — and so how often
   * populace writes into somebody's issue tracker. A project in version control has to be able to
   * set it, and for a while it could not be set anywhere at all: it was on the stored schema and on
   * nothing that reads a file or a form.
   */
  it("carries a study's report cycle into the config a run reads it out of", () => {
    const loaded = loadConfig(
      fileWith(`${head}studies:
  - slug: soak
    mode: longitudinal
    reportCycle: { every: 6h, jitter: 20m, initialDelay: 1h, everyVisits: 40 }
${cohorts}`),
    );
    expect(loaded.config.simulation.reportCycle).toEqual({ every: 6 * 3_600_000, jitter: 20 * 60_000, initialDelay: 3_600_000, everyVisits: 40 });

    // A field the file did not write keeps the schema's own rhythm rather than arriving at nought,
    // and `everyVisits: null` is a choice — time as the only trigger — and not an absence.
    const partial = loadConfig(fileWith(`${head}studies:\n  - slug: soak\n    mode: longitudinal\n    reportCycle: { every: 15m, everyVisits: null }\n${cohorts}`));
    expect(partial.config.simulation.reportCycle).toEqual({ every: 15 * 60_000, jitter: 300_000, initialDelay: 0, everyVisits: null });

    // A file that says nothing about it is the common case and still has a cycle to run on.
    const silent = loadConfig(fileWith(`${head}studies:\n  - slug: soak\n    mode: longitudinal\n${cohorts}`));
    expect(silent.config.simulation.reportCycle.every).toBe(3_600_000);

    // And a duration nobody can read is a load error, not a surprise an hour into a run.
    expect(() => loadConfig(fileWith(`${head}studies:\n  - slug: soak\n    mode: longitudinal\n    reportCycle: { every: soon }\n${cohorts}`))).toThrow();
  });

  it("refuses an ephemeral study without a cap, in the product's words", () => {
    expect(() => loadConfig(fileWith(`${head}studies:\n  - slug: trial\n    mode: ephemeral\n${cohorts}`))).toThrow(/study trial: an ephemeral study has to end/);
  });
});

describe("populace validate", () => {
  it("says study, and warns when a plan's size is not what the cohorts add up to", async () => {
    const differing = await validate({
      config: fileWith(`${head}studies:\n  - slug: trial\n    mode: ephemeral\n    visitsPerPerson: 3\n    size: 9\n${cohorts}`),
      connect: false,
    });
    const text = differing.lines.join("\n");
    expect(text).toContain("study trial: ephemeral, 3 visit(s) each, 3 people");
    expect(text).toContain("WARNING study trial says size 9, but its cohorts add up to 3");
    expect(text).not.toMatch(/^simulation /m);

    // A plan that names the same size, or none, has nothing to be warned about.
    const agreeing = await validate({ config: fileWith(`${head}studies:\n  - slug: trial\n    mode: ephemeral\n    visitsPerPerson: 3\n    size: 3\n${cohorts}`), connect: false });
    expect(agreeing.lines.join("\n")).not.toContain("WARNING");
    const silent = await validate({ config: fileWith(`${head}${cohorts}`), connect: false });
    expect(silent.lines.join("\n")).not.toContain("WARNING");
  });
});
