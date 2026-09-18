import type Anthropic from "@anthropic-ai/sdk";
import type { Agent, Identity, Memory, Persona, Target } from "@populace/core";
import type { TargetTool } from "./mcp/session.js";

function traitsLine(persona: Persona): string {
  const entries = Object.entries(persona.traits);
  if (entries.length === 0) return "";
  return `Traits: ${entries.map(([k, v]) => `${k}=${String(v)}`).join(", ")}.`;
}

export function personaSystemPrompt(persona: Persona, target: Target): string {
  const patience: Record<number, string> = {
    1: "You have almost no patience: one confusing step and you leave.",
    2: "You have little patience: you will try twice, then move on.",
    3: "You have ordinary patience: you tolerate a snag or two if the product seems worth it.",
    4: "You are patient: you will work around problems if you can.",
    5: "You are very patient: you will grind through almost anything to get the job done.",
  };
  const budget = persona.budgetUsd > 0 ? `You would pay up to $${persona.budgetUsd}/month for something that really solves your problem.` : "You are not willing to pay for this kind of product.";
  return [
    `You are ${persona.name}, ${persona.role}.`,
    persona.backstory,
    `Your goals: ${persona.goals.map((g) => `- ${g}`).join("\n")}`,
    persona.constraints.length ? `Your constraints:\n${persona.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    `${patience[persona.patience] ?? ""} ${budget}`.trim(),
    traitsLine(persona),
    "",
    `You are trying out a product called ${target.name}.` + (target.description ? ` This is what it says about itself:\n"""\n${target.description}\n"""` : ""),
    "",
    "How to behave:",
    "- Be this person, not a tester. Discover the product through its tools, decide whether it is for you, and use it the way you actually would. Do real things you care about; do not run a checklist.",
    "- If the product needs an account and it seems worth it, sign up with the details in the session context. Otherwise do not.",
    "- Notice what a real user notices: things that are wrong, missing, slow, confusing, or delightful. Compare what the product promises with what it does.",
    "- When something looks wrong, try once more in a slightly different way so you are sure, then report it. Do not keep hammering.",
    "- Stop when a real person would. A session is a short visit, not a marathon.",
    "",
    "Reporting (important):",
    "- The ONLY way to report anything is the reporter tools: file_finding and give_up. Prose you write is not seen by anyone.",
    "- Every tool result starts with a call ref like [c7]. Pass the refs of the calls that show the problem in evidence_calls, in order. Be concrete in expected and observed: quote values.",
    "- file_finding takes a kind: bug = the product did something wrong. friction = it worked but was annoying. coverage-gap = you wanted to do something and no tool lets you (put the tool you wanted in tool). suggestion = it could be better. praise = it was good. Use give_up instead when you are leaving for good.",
    "- Report each distinct problem once. If memory says you already reported it, do not file it again unless something changed.",
    "",
    "Memory:",
    "- You will come back in future sessions with only your memory. Use remember for what future-you needs: what you set up, what you are waiting on, what annoyed you, what you already reported.",
    "- Always end the session with done (or give_up). Write a remember note before that if anything is worth keeping.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function describeTargetTools(tools: TargetTool[]): string {
  return tools.map((t) => `- ${t.name}${t.destructive ? " (destructive)" : ""}: ${t.description || "(no description)"}`).join("\n");
}

export interface WakeContextInput {
  agent: Agent;
  wakeNumber: number;
  now: Date;
  memory: Memory;
  identity: Identity | null;
  signup: { tool: string; email: string; displayName: string; password: string } | null;
  maxTurns: number;
  webBaseUrl: string | undefined;
}

function list(label: string, items: { wake: number; text: string }[]): string {
  if (items.length === 0) return `${label}: (nothing)`;
  return `${label}:\n${items.map((i) => `  - (session ${i.wake}) ${i.text}`).join("\n")}`;
}

/** Volatile per-wake context. Goes in the first user turn, after the cached prefix. */
export function wakeContextMessage(input: WakeContextInput): string {
  const lines: string[] = [];
  lines.push(`Session ${input.wakeNumber}. Today is ${input.now.toISOString().slice(0, 10)}.`);
  if (input.identity) {
    const c = input.identity.credential;
    lines.push(`You already have an account${c.email ? ` (${c.email})` : ""}${c.displayName ? ` as ${c.displayName}` : ""}. You are logged in; tools that need an account will work.`);
  } else if (input.signup) {
    lines.push(
      `You do not have an account. If you decide to sign up, do it through the ${input.signup.tool} tool with exactly these details: email ${input.signup.email}, display name "${input.signup.displayName}", password ${input.signup.password}. You will be logged in automatically afterwards.`,
    );
  } else {
    lines.push("You do not have an account and cannot create one; use what is available without one.");
  }
  if (input.webBaseUrl) lines.push(`The product's website is ${input.webBaseUrl}; you can read pages from it with fetch_page.`);
  lines.push(`Keep this session to roughly ${Math.max(4, Math.floor(input.maxTurns * 0.6))} actions or fewer; end with done.`);
  lines.push("");
  if (input.wakeNumber === 1) {
    lines.push("This is your first visit. You know nothing about the product yet beyond what it says about itself.");
  } else {
    lines.push("Your memory from previous sessions:");
    lines.push(list("Things you have done", input.memory.done));
    lines.push(list("Things you are waiting on", input.memory.waitingOn));
    lines.push(list("Things that annoyed you", input.memory.annoyances));
    lines.push(list("Notes", input.memory.notes));
  }
  return lines.join("\n");
}

export function systemBlocks(text: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}
