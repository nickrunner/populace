import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { JsonObject, JsonValue } from "@populace/core/isomorphic";
import type { Finding, TraceEvent } from "../api.js";
import { clock, ms, usd4, wakeOutcome } from "../format.js";
import { Avatar, CallRef, Card, Failed, Loading, Mono, Payload } from "../components/ui.jsx";

/**
 * The trace already records every model turn, tool call, guardrail trip, memory write and finding
 * in sequence; until now it went into SQLite and was never shown to anyone. This screen is that
 * sequence, and it is the instrument surface's centrepiece.
 */

/** A model turn's content is stored as JSON in the trace; pull out the text blocks and nothing else. */
function turnText(content: JsonValue): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const record: JsonObject = block;
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** What filing each kind of finding actually is, in words, rather than "Files a <enum>". */
const FILES: Record<string, string> = {
  bug: "Files a bug",
  friction: "Reports friction",
  "coverage-gap": "Files a coverage gap",
  suggestion: "Makes a suggestion",
  abandonment: "Walks away",
  praise: "Says something worked",
};

const truncate = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max)}…` : value);

interface Row {
  seq: number;
  kind: string;
  ref?: string;
  title: string;
  sub: string;
  meta: string;
  suspect: boolean;
}

function rowFor(event: TraceEvent, wakeNumber: number): Row {
  const base = { seq: event.seq, suspect: false };
  switch (event.type) {
    case "wake.start":
      return { ...base, kind: "start", title: `Visit ${wakeNumber} begins`, sub: `${event.agentId} · ${event.runId}`, meta: clock(event.at) };
    case "memory":
      return { ...base, kind: "memory", title: "Writes to their notes", sub: `${event.operation}: ${event.text}`, meta: "" };
    case "model.call":
      return {
        ...base,
        kind: "model",
        title: `Turn ${event.turn}`,
        sub: truncate(turnText(event.response.content), 130),
        meta: `${ms(event.latencyMs)} · ${usd4(event.costUsd)}`,
      };
    case "tool.call":
      return {
        ...base,
        kind: "tool",
        ref: event.ref,
        title: event.tool,
        sub: `${truncate(JSON.stringify(event.arguments), 60)} → ${truncate(event.result.text.replace(/\s+/g, " "), 70)}`,
        meta: ms(event.latencyMs),
        suspect: event.result.isError,
      };
    case "reporter.call":
      return { ...base, kind: "reporter", title: event.tool, sub: truncate(JSON.stringify(event.arguments), 120), meta: event.accepted ? "" : "rejected" };
    case "guardrail":
      return { ...base, kind: "guardrail", title: event.rule, sub: event.detail, meta: "", suspect: true };
    case "identity":
      return { ...base, kind: "identity", title: `Account ${event.event}`, sub: event.detail, meta: event.strategy };
    case "finding":
      return { ...base, kind: "finding", title: FILES[event.kind] ?? `Files a ${event.kind}`, sub: event.title, meta: "" };
    case "note":
      return { ...base, kind: "note", title: "Note", sub: event.text, meta: "" };
    case "wake.end":
      return {
        ...base,
        kind: "end",
        title: `Visit ends: ${wakeOutcome(event.status)}`,
        sub: event.summary,
        meta: `${event.turns} turns · ${usd4(event.costUsd)}`,
      };
  }
}

const KIND_INK: Record<string, string> = {
  tool: "text-evidence",
  guardrail: "text-high",
  finding: "text-critical",
  memory: "text-accent",
  identity: "text-accent",
};

function Detail({ event, findings, runId }: { event: TraceEvent; findings: Finding[]; runId: string }) {
  if (event.type === "tool.call") {
    const cited = findings.filter((f) => f.reproduction.some((step) => step.ref === event.ref));
    return (
      <>
        <div className="flex items-baseline gap-2.5 mb-1">
          <CallRef>{event.ref}</CallRef>
          <Mono className="text-[14px] text-ink">{event.tool}</Mono>
        </div>
        <div className="t-meta text-ink-muted mb-5 font-mono">
          {event.endpoint} · {ms(event.latencyMs)} · {clock(event.at)}
        </div>

        <div className="t-label text-ink-muted mb-1.5">What they sent</div>
        <div className="mb-4">
          <Payload>{JSON.stringify(event.arguments, null, 2)}</Payload>
        </div>

        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="t-label text-ink-muted">What came back</span>
          {event.result.isError ? <span className="t-meta text-critical">error</span> : null}
        </div>
        <Payload>{event.result.text}</Payload>

        {cited.length > 0 ? (
          <div className="mt-6 border-t border-rule pt-4">
            <div className="t-label text-ink-muted mb-2">Cited as evidence</div>
            {cited.map((finding) => (
              <div key={finding.id} className="mb-2">
                <p className="t-body">{finding.title}</p>
                <div className="t-meta text-ink-muted mt-0.5">
                  step {finding.reproduction.findIndex((s) => s.ref === event.ref) + 1} of {finding.reproduction.length} ·{" "}
                  {finding.reproduction.map((s) => s.ref).join(" ")}
                </div>
              </div>
            ))}
            <Link to={`/runs/${encodeURIComponent(runId)}/findings`} className="t-meta text-accent hover:underline">
              see it in full
            </Link>
          </div>
        ) : null}
      </>
    );
  }

  if (event.type === "model.call") {
    return (
      <>
        <div className="t-section mb-1">Turn {event.turn}</div>
        <div className="t-meta text-ink-muted mb-5 font-mono">
          {event.model} · {event.effort} · {ms(event.latencyMs)} · {usd4(event.costUsd)} · {event.usage.inputTokens.toLocaleString()} in /{" "}
          {event.usage.outputTokens.toLocaleString()} out
        </div>
        <div className="t-label text-ink-muted mb-1.5">What they were thinking</div>
        <p className="t-body text-ink-soft mb-5">{turnText(event.response.content) || "They went straight to a tool call without saying anything."}</p>
        <div className="t-label text-ink-muted mb-1.5">What they had just been told</div>
        <Payload>{event.request.lastUserContent}</Payload>
      </>
    );
  }

  const row = rowFor(event, 0);
  return (
    <>
      <div className="t-section mb-1">{row.title}</div>
      <div className="t-meta text-ink-muted mb-5 font-mono">
        {event.type} · {clock(event.at)}
      </div>
      <p className="t-body text-ink-soft whitespace-pre-wrap">{row.sub || "Nothing more was recorded for this step."}</p>
    </>
  );
}

export function WatchAVisit({ runId }: { runId: string }) {
  const { wakeId } = useParams();
  const id = wakeId ?? "";
  const [selected, setSelected] = useState<number | null>(null);

  const wake = useQuery({ queryKey: ["wake", id], queryFn: () => api.wake(id) });
  const trace = useQuery({ queryKey: ["trace", id], queryFn: () => api.trace(id) });
  const findings = useQuery({ queryKey: ["findings", runId], queryFn: () => api.findings(runId) });
  const memory = useQuery({
    queryKey: ["memory", runId, wake.data?.agentId],
    queryFn: () => api.memory(runId, wake.data?.agentId ?? ""),
    enabled: wake.data !== undefined,
  });

  if (wake.isError) return <Failed error={wake.error} />;
  const wakeData = wake.data;
  const traceData = trace.data;
  if (!wakeData || !traceData) return <Loading what="this visit" />;

  const events = traceData.items;
  // The first interesting step, so the pane is never empty on arrival.
  const fallback = events.find((e) => e.type === "tool.call") ?? events[0];
  const current = events.find((e) => e.seq === selected) ?? fallback;
  const mine = (findings.data?.items ?? []).filter((f) => f.wakeId === id);

  const counts = {
    tools: events.filter((e) => e.type === "tool.call").length,
    findings: events.filter((e) => e.type === "finding").length,
    guardrails: events.filter((e) => e.type === "guardrail").length,
    memory: events.filter((e) => e.type === "memory").length,
  };

  // What they walked back in remembering: the thing nothing else in this category can show.
  const carried = [...(memory.data?.waitingOn ?? []), ...(memory.data?.annoyances ?? [])].filter((entry) => entry.wake < wakeData.wakeNumber);

  return (
    <>
      <div className="t-meta text-ink-muted mb-2">
        <Link to={`/runs/${encodeURIComponent(runId)}/wakes`} className="text-accent hover:underline">
          Wakes
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <Avatar name={wakeData.personaName} />
        <h1 className="t-title">
          {wakeData.personaName}, visit {wakeData.wakeNumber}
        </h1>
        <span className="t-meta text-ink-muted">{wakeOutcome(wakeData.status)}</span>
      </div>
      <Mono className="text-[11px] text-ink-muted block mb-5">{wakeData.id}</Mono>

      {carried.length > 0 ? (
        <Card className="p-4 mb-6 bg-well">
          <div className="t-label text-ink-muted mb-1.5">What they walked back in remembering</div>
          <ul className="flex flex-col gap-1">
            {carried.slice(0, 3).map((entry, index) => (
              <li key={`${entry.wake}-${index}`} className="t-body text-ink-soft flex gap-2">
                <span className="flex-1">{entry.text}</span>
                <span className="t-meta text-ink-muted shrink-0">visit {entry.wake}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-5 t-meta text-ink-muted mb-4 pb-4 border-b border-rule">
        <span>Tool calls {counts.tools}</span>
        <span>Findings {counts.findings}</span>
        <span>Guardrails {counts.guardrails}</span>
        <span>Memory {counts.memory}</span>
        <span className="ml-auto">
          {wakeData.turns} turns · {usd4(wakeData.costUsd)}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div>
          <div className="t-label text-ink-muted mb-2">Click a step to inspect it</div>
          <ol className="flex flex-col">
            {events.map((event) => {
              const row = rowFor(event, wakeData.wakeNumber);
              const active = current?.seq === event.seq;
              return (
                <li key={event.seq}>
                  <button
                    type="button"
                    onClick={() => setSelected(event.seq)}
                    className={`w-full text-left flex gap-3 px-3 py-2 rounded-md border ${
                      active ? "bg-accent-wash border-accent/30" : "border-transparent hover:bg-well"
                    }`}
                  >
                    <span className="font-mono text-[11px] text-ink-muted tabular-nums pt-0.5 shrink-0">{String(row.seq).padStart(4, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        {row.ref ? <CallRef>{row.ref}</CallRef> : null}
                        <span className={`t-body font-medium ${row.suspect ? "text-critical" : (KIND_INK[row.kind] ?? "text-ink")} ${row.kind === "tool" ? "font-mono text-[12.5px]" : ""}`}>
                          {row.title}
                        </span>
                        {row.meta ? <span className="t-meta text-ink-muted ml-auto shrink-0 font-mono">{row.meta}</span> : null}
                      </span>
                      {row.sub ? <span className={`block t-meta text-ink-muted mt-0.5 ${row.kind === "tool" ? "font-mono" : ""}`}>{row.sub}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <Card className="p-5 sticky top-9">
          {current ? <Detail event={current} findings={mine} runId={runId} /> : <p className="t-body text-ink-muted">This visit recorded no steps.</p>}
        </Card>
      </div>
    </>
  );
}
