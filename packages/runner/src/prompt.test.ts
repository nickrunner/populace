import { PopulaceConfigSchema, expandPopulation, type Agent, type PopulaceConfig } from "@populace/core";
import { describe, expect, it } from "vitest";
import { personaSystemPrompt } from "./prompt.js";

const context = "You keep your lists on your phone, in the gaps between other things.";
const details = "On a cracked phone, trying to plan one weekend before the shops shut.";
const brief = "Tasklet is new to you this week; a friend said it was calmer than what you use now.";

/** A resolved config with one lane and one written person, the way a snapshot carries them. Nothing here connects to anything. */
function fixture(): { agent: Agent; config: PopulaceConfig } {
  const config = PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:1/mcp" }], description: "A calm task list." },
    identity: { strategy: "none" },
    population: {
      id: "test",
      members: [
        {
          cohort: "casual-listers",
          context,
          persona: { id: "casual", name: "Casual lister", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a grocery list"] },
          people: [{ ordinal: 0, id: "casual-listers.casual#1", name: "Ines Okonkwo", details, handle: "ines-okonkwo-casual-listers-casual-1" }],
        },
      ],
    },
  });
  const [expanded] = expandPopulation(config.population, "run_0_000000", config.simulation.id);
  if (!expanded) throw new Error("no agent");
  return { agent: expanded.agent, config };
}

describe("personaSystemPrompt", () => {
  /**
   * D3b: the study's brief is what a study says to everyone it sends, so it sits with the other
   * shared lines — after the cohort's context, which is more general than it, and before the
   * person's own line, which is more particular. Asserted by position, not by presence alone,
   * because "the general before the particular" is the rule the prompt is built on.
   */
  it("renders the brief after the cohort's context and before the person's own line", () => {
    const { agent, config } = fixture();
    const system = personaSystemPrompt(agent, config.target, brief);
    const lines = system.split("\n");
    const at = (text: string): number => lines.indexOf(text);
    expect(at(context)).toBeGreaterThan(0);
    expect(at(brief)).toBe(at(context) + 1);
    expect(at(details)).toBe(at(brief) + 1);
    expect(lines[0]).toBe(`You are ${agent.name}, ${agent.persona.role}.`);
  });

  /**
   * An empty brief is the default, and it has to leave the prefix byte-identical to one built
   * without the parameter: the system prompt is the cached prefix (ADR-0006), and a stray blank
   * line would be a second version of every prompt in the wild.
   */
  it("adds nothing when the brief is empty", () => {
    const { agent, config } = fixture();
    const bare = personaSystemPrompt(agent, config.target);
    expect(personaSystemPrompt(agent, config.target, "")).toBe(bare);
    expect(bare).not.toContain(brief);
    expect(bare.split("\n").indexOf(details)).toBe(bare.split("\n").indexOf(context) + 1);
  });

  /** Per-run constant in, per-run constant out: the same brief gives the same prefix every time. */
  it("is stable across calls with the same brief", () => {
    const { agent, config } = fixture();
    expect(personaSystemPrompt(agent, config.target, brief)).toBe(personaSystemPrompt(agent, config.target, brief));
  });
});
