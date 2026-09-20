import { createHash } from "node:crypto";
import type { FindingKind } from "./schemas/finding.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "was", "it", "its", "for", "with", "when", "that", "this",
  "not", "but", "does", "did", "do", "be", "by", "as", "at", "from",
]);

/**
 * The one tokenizer. It lived in `packages/reports/src/cluster.ts`, where the digest used it for
 * jaccard similarity; the signature has to be computed at file time, in the runner, from the same
 * tokens the clusterer will later group on, so both sides now share this.
 */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/**
 * ADR-0028's stable key for "this problem", versioned as the ADR asks: `sig1:<12 hex>`.
 *
 * Positional cluster ids (`cluster-3`) cannot answer "is this the same thing we saw last
 * execution?" — they move when anything else moves. A signature can, because it is a function of
 * the finding's content alone. The `sig1:` prefix is the version: a change to what goes into the
 * hash bumps it, which detaches triage loudly instead of silently reattaching it to the wrong
 * problem.
 */
export function signatureOf(kind: FindingKind, tool: string, title: string): string {
  const tokens = [...titleTokens(title)].sort().join(" ");
  return `sig1:${createHash("sha256").update(`${kind}|${tool}|${tokens}`).digest("hex").slice(0, 12)}`;
}
