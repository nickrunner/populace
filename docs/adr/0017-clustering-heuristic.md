# ADR-0017: Clustering by kind, primary tool and title similarity

**Status:** accepted

## Decision

Findings cluster when they share `kind` and primary tool (the tool of the last evidence call, or the tool named in a coverage gap) and their normalised titles have token Jaccard similarity above a threshold (default 0.5). Clusters are ordered by severity rank, then by number of distinct personas, then count. The representative is the confirmed finding with the highest confidence. Model-based clustering is deferred; this heuristic is cheap, explainable and enough for the mock target.

