import { z } from "zod";

const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses `"90s"`, `"2m"`, `"1.5h"`, `"1d"` or a bare number of milliseconds. */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/.exec(value);
  if (!match) throw new Error(`invalid duration: ${JSON.stringify(value)}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  return Math.round(amount * (unitMs[unit] ?? 1));
}

export const DurationSchema = z
  .union([z.string(), z.number().nonnegative()])
  .refine((v) => {
    try {
      parseDuration(v);
      return true;
    } catch {
      return false;
    }
  }, "expected a duration like 30s, 2m, 1h")
  .transform(parseDuration);

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)}m`;
  return `${(ms / 3_600_000).toFixed(ms % 3_600_000 === 0 ? 0 : 1)}h`;
}
