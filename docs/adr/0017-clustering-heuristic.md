# ADR-0017: Clustering by kind, primary tool and title similarity

**Status:** accepted

## Decision

Findings cluster when they share `kind` and primary tool (the tool of the last evidence call, or the tool named in a coverage gap) and their normalised titles have token Jaccard similarity at or above a threshold (default 0.3; kind and tool already constrain the group, and independent personas word the same bug differently). Clusters are ordered by severity rank, then by number of distinct personas, then count. The representative is the confirmed finding with the highest confidence. Model-based clustering is deferred; this heuristic is cheap, explainable and enough for the mock target.


## Amendment (2026-09-18): a cluster carries a signature and per-cohort incidence

Cluster ids were positional — a cluster's identity was its place in one digest of one run — which
made "is this the same problem we saw last time?" unanswerable without re-clustering both sides, and
made a link to a problem invalid the moment the next execution reordered the list.

A cluster now carries a **versioned content signature**, `sig1:<12 hex>` over `(kind, primary tool,
sorted title tokens)`, computed in `packages/core/src/signature.ts` and stamped onto every finding
as it is filed. The tokenizer that ADR-0017's Jaccard similarity already used moved into core so
both sides share exactly one implementation of "what are the words in this title". Clustering itself
is unchanged: same kind, same primary tool, token Jaccard at or above the threshold.

Two consequences follow, and both are load-bearing for the product above:

- **A URL is a signature.** The finding page is `/p/:proj/s/:sim/f/:signature`, so a bookmark
  survives the next execution and triage attaches to the problem rather than to a row (ADR-0028).
- **A cluster knows who it happened to, by cohort.** `ClusterCardView.cohorts` carries `{slug, name,
  hit, total}` per cohort, which is the number the whole restructure exists to produce: "six of the
  twelve first-timers and none of the eight sceptics" is a different fact from "nine people", and it
  is readable without naming anybody (SPEC §7.1).

What a signature is *not* is a semantic identity. See ADR-0028's amendment for the measured
consequence and for what the UI is therefore allowed to claim.
