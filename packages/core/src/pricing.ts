import { DEFAULT_PRICES, type ModelPrice } from "./schemas/model.js";
import type { Usage } from "./schemas/trace.js";

export function priceFor(model: string, overrides: Record<string, ModelPrice> = {}): ModelPrice {
  const price = overrides[model] ?? DEFAULT_PRICES[model];
  if (price) return price;
  // Unknown model: bill at the most expensive known rate so ceilings stay conservative.
  const opus = DEFAULT_PRICES["claude-opus-5"];
  if (!opus) throw new Error("default price table is empty");
  return opus;
}

/** Dollar cost of one call. Prices are per million tokens. */
export function costOf(usage: Usage, price: ModelPrice): number {
  const perToken = 1 / 1_000_000;
  const usd =
    usage.inputTokens * price.input * perToken +
    usage.outputTokens * price.output * perToken +
    usage.cacheCreationInputTokens * price.cacheWrite * perToken +
    usage.cacheReadInputTokens * price.cacheRead * perToken;
  return Number(usd.toFixed(8));
}

export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}
