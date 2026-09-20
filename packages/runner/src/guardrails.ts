import { addUsage, totalTokens, type Guardrails, type Store, type Usage, ZERO_USAGE } from "@populace/core";

export interface BudgetState {
  usage: Usage;
  costUsd: number;
  turns: number;
}

export type BudgetBreach = { rule: "per-wake-tokens" | "per-wake-usd" | "max-turns"; detail: string } | null;

/** Per-wake accounting; the rules themselves live here, not in the prompt (ADR-0009). */
export class WakeBudget {
  private state: BudgetState = { usage: ZERO_USAGE, costUsd: 0, turns: 0 };

  constructor(private readonly limits: Guardrails["perWake"]) {}

  record(usage: Usage, costUsd: number): void {
    this.state = { usage: addUsage(this.state.usage, usage), costUsd: this.state.costUsd + costUsd, turns: this.state.turns + 1 };
  }

  get snapshot(): BudgetState {
    return this.state;
  }

  /** First rule breached, if any. Checked after every model call. */
  breach(): BudgetBreach {
    const tokens = totalTokens(this.state.usage);
    if (tokens >= this.limits.maxTokens) return { rule: "per-wake-tokens", detail: `${tokens} tokens >= ceiling ${this.limits.maxTokens}` };
    if (this.state.costUsd >= this.limits.maxUsd) return { rule: "per-wake-usd", detail: `$${this.state.costUsd.toFixed(4)} >= ceiling $${this.limits.maxUsd}` };
    if (this.state.turns >= this.limits.maxTurns) return { rule: "max-turns", detail: `${this.state.turns} turns >= ceiling ${this.limits.maxTurns}` };
    return null;
  }
}

export async function dailyCeilingBreached(store: Store, populationId: string, dailyUsd: number, now: Date): Promise<string | null> {
  const spent = await store.costSince({ populationId }, new Date(now.getTime() - 86_400_000));
  return spent >= dailyUsd ? `population ${populationId} spent $${spent.toFixed(2)} in the last 24h >= ceiling $${dailyUsd}` : null;
}

export async function killSwitchReason(store: Store): Promise<string | null> {
  const kill = await store.getKillSwitch();
  return kill.engaged ? `kill switch engaged${kill.reason ? `: ${kill.reason}` : ""}` : null;
}
