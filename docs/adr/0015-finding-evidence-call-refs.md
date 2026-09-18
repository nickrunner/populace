# ADR-0015: Findings reference evidence by call ref

**Status:** accepted

## Decision

Every target tool call in a wake gets a ref `c<N>` that the runner prepends to the tool result the model sees. `file_finding` and `give_up` take `evidence_calls: string[]`. The runner resolves refs into full `ToolCallRecord`s (tool, arguments, result content, error flag, latency, trace seq) and stores them as the finding reproduction steps. If the model passes no refs, the runner attaches the last five target calls so a finding is never evidence-free.

