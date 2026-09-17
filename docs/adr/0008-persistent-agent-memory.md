# ADR-0008: Persistent per-agent memory

**Status:** accepted (fixed by brief)

## Decision

Memory is one document per agent:

```
{ notes: [{wake, text}], waitingOn: [...], annoyances: [...], done: [...], updatedAt }
```

Notes are free-form; the structured slice answers three questions a returning user asks: what was I waiting on, what annoyed me last time, what have I already done. Memory is loaded into every wake context and written only through `remember`. It is versioned by wake number so the digest can show when an annoyance first appeared.

Memory is capped (configurable, default 60 notes) by dropping the oldest notes, never the structured slice.

