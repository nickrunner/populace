import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { JsonValue, ToolCallRecord } from "@populace/contract";

import { api, isMissing } from "../api.js";
import type { Finding, Participant, TraceEvent } from "../api.js";
import { keys, q, WATCHING } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { clock, ms, plural, wakeOutcome } from "../format.js";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  CitedAsEvidence,
  Inline,
  Link,
  Money,
  Mono,
  PageHeader,
  PayloadBlock,
  Section,
  Skeleton,
  SplitPage,
  Stack,
  Stat,
  StatGroup,
  StateBlock,
  Text,
  ToolCallBlock,
  TranscriptDetail,
  TranscriptList,
  type CitedFinding,
  type Crumb,
  type MetaFact,
  type SeverityLevel,
  type StateKind,
  type TranscriptKind,
  type TranscriptStep,
} from "../design/index.js";

/**
 * One visit, step by step — the instrument surface's centrepiece.
 *
 * The trace has always recorded every turn, every call to the target, every guardrail trip, every
 * note and every report in sequence; until this screen existed it went into SQLite and was shown
 * to nobody. What it is now is a **ledger**: a roving-tabindex listbox of steps on the left, and
 * the step you are standing on, in full, on the right.
 *
 * Four things this screen used to do that it no longer does (ATOMIC-INVENTORY §6.3, row 24).
 *
 * **Two hundred tab stops became one.** Every step was a `<button>` with no focus style on it, so
 * reaching the detail pane by keyboard meant two hundred presses past rows that never showed where
 * you were. `TranscriptList` is one composite: arrows and Home/End move, `aria-activedescendant`
 * names the current option, and selection follows the arrows.
 *
 * **Nothing reflows under the reader.** A visit that is still going is re-read every two seconds,
 * and the rows are memoised on their own values so an arriving step re-renders itself and nothing
 * else. Arriving steps never steal the selection either — the reader stays on the step they were
 * reading.
 *
 * **No machine word reaches the page.** `event.type` was printed raw in the detail pane; a
 * guardrail's rule — `per-wake-tokens`, `max-turns` — was printed raw as a step's title, which put
 * the forbidden vocabulary of ADR-0032 on screen in the product's own voice; a memory write was
 * titled with its storage kind and an account event with its enum. All four are looked up as
 * sentences here, and the step's kind reaches `TranscriptDetail` as a `TranscriptKind` rather than
 * as a row name.
 *
 * **Nothing is cut.** Payloads were sliced at 600 characters with no affordance, in the one place
 * in the product where the bytes *are* the evidence. `PayloadBlock` folds instead: pretty-printed,
 * always copyable, always one press from whole.
 *
 * The step's sub-line is still a preview and is still elided — a one-line row cannot be anything
 * else — but the preview is never the only copy of the bytes any more; the pane beside it holds
 * them entire.
 */

/** A step's sub-line is one line, so it is elided. The pane beside it holds the whole thing. */
const PREVIEW = 160;
const preview = (value: string): string =>
  value.length > PREVIEW ? `${value.slice(0, PREVIEW)}…` : value;

/** Machine output on one line: collapse the whitespace it was formatted with. */
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * A model turn's content arrives as JSON blocks. Only the text ones are words, and the row's
 * sub-line is the words.
 */
function spokenText(content: JsonValue): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const type = block["type"];
    const text = block["text"];
    if (type === "text" && typeof text === "string") parts.push(text);
  }
  return oneLine(parts.join(" "));
}

/** What filing each kind of report actually is, in words, rather than "Files a <enum>". */
const FILES: Record<string, string> = {
  bug: "Files a bug",
  friction: "Reports friction",
  "coverage-gap": "Files a coverage gap",
  suggestion: "Makes a suggestion",
  abandonment: "Walks away",
  praise: "Says something worked",
};

/**
 * A memory write's storage kind, as a sentence. `MemoryKindSchema`'s five values are how the row
 * is filed; none of them is how a person would say it.
 */
const REMEMBERS: Record<string, string> = {
  note: "Makes a note to themselves",
  waiting_on: "Notes what they are waiting on",
  annoyance: "Notes what annoyed them",
  done: "Notes what they got done",
  resolved: "Crosses something off",
};

/**
 * A guardrail's rule, as a sentence about what was stopped.
 *
 * This is not only a copy fix. Two of these rules are spelled `per-wake-…`, and printing the rule
 * raw — which is what this screen did — put the word ADR-0032 keeps off the wire into the largest
 * text on the panel. A guardrail is the runner speaking about its own run, so the title says what
 * it stopped and the row keeps the product's own ink; the severity arc means severity and is left
 * alone (§4.1).
 */
const STOPPED: Record<string, string> = {
  "kill-switch": "The kill switch stopped them",
  "per-wake-tokens": "They reached this visit's token ceiling",
  "per-wake-usd": "They reached this visit's spending ceiling",
  "daily-usd": "The population reached its daily spending ceiling",
  "tool-denied": "A tool was refused by policy",
  "destructive-confirm": "A destructive call was held for confirmation",
  "destructive-denied": "A destructive call was refused",
  "max-turns": "They reached the turn ceiling",
  "web-fetch-denied": "A page fetch was refused",
};

/** What happened to their account on the target app, in words. */
const ACCOUNT: Record<string, string> = {
  provisioned: "An account was made for them",
  captured: "They signed themselves up",
  missing: "They had no account",
  reconnected: "They signed back in",
  redeemed: "They redeemed their credentials",
  rejected: "The app turned their credentials down",
};

/** The reporter toolset, in words. These are the runner's own tools, not the target's. */
const REPORTED: Record<string, string> = {
  file_finding: "Files a report",
  give_up: "Gives up",
  remember: "Writes something down",
  done: "Calls it done",
  fetch_page: "Reads a page",
};

/** The kind a trace event is, in the vocabulary the transcript speaks (ADR-0032). */
const KINDS: Record<TraceEvent["type"], TranscriptKind> = {
  "wake.start": "visit.start",
  memory: "memory",
  "model.call": "model.turn",
  "tool.call": "tool.call",
  "reporter.call": "reporter.call",
  guardrail: "guardrail",
  identity: "identity",
  finding: "finding",
  note: "note",
  "wake.end": "visit.end",
};

/** A trace event's sequence number is its id in the list and in the URL of nothing. */
const stepId = (event: TraceEvent): string => String(event.seq);

/**
 * One trace event as one row. The meta column is a single fact on purpose — how long the step
 * took, or when it happened — because a row's measurement is scanned down a column and a middle
 * dot between two facts is what §4.5 exists to stop.
 */
function stepFor(
  event: TraceEvent,
  visitNumber: number,
  severityOf: (findingId: string) => SeverityLevel | undefined,
): TranscriptStep {
  const base = { id: stepId(event), seq: event.seq, kind: KINDS[event.type] };
  switch (event.type) {
    case "wake.start":
      // The sub-line was `agentId · runId`: the forbidden vocabulary and a middle dot in one
      // line, naming two ids a reader of a visit has no use for.
      return { ...base, title: `Visit ${String(visitNumber)} begins`, meta: clock(event.at) };
    case "memory":
      return {
        ...base,
        title: REMEMBERS[event.operation] ?? "Writes to their notes",
        sub: preview(event.text),
      };
    case "model.call":
      return {
        ...base,
        title: `Turn ${String(event.turn)}`,
        sub: preview(spokenText(event.response.content)),
        meta: ms(event.latencyMs),
      };
    case "tool.call":
      return {
        ...base,
        title: event.tool,
        callRef: event.ref,
        sub: preview(`${oneLine(JSON.stringify(event.arguments))} → ${oneLine(event.result.text)}`),
        meta: ms(event.latencyMs),
        suspect: event.result.isError,
      };
    case "reporter.call":
      return {
        ...base,
        title: REPORTED[event.tool] ?? event.tool,
        sub: preview(oneLine(event.result)),
        meta: event.accepted ? undefined : "rejected",
      };
    case "guardrail":
      return { ...base, title: STOPPED[event.rule] ?? "A guardrail stopped them", sub: event.detail };
    case "identity":
      return {
        ...base,
        title: ACCOUNT[event.event] ?? "Their account on the app",
        sub: event.detail,
        meta: event.strategy,
      };
    case "finding":
      return {
        ...base,
        title: FILES[event.kind] ?? "Files a report",
        sub: event.title,
        severity: severityOf(event.findingId),
      };
    case "note":
      return { ...base, title: "A note on the record", sub: event.text };
    case "wake.end":
      return {
        ...base,
        title: `Visit ends: ${wakeOutcome(event.status)}`,
        sub: event.summary,
        meta: clock(event.at),
      };
  }
}

/** Who made this visit. The row carries a participant id; the roster carries the name. */
const personFor = (people: Participant[], id: string): Participant | undefined =>
  people.find((person) => person.id === id);

/**
 * The pane beside the list.
 *
 * A call to the target app is the one step with a shape of its own, and the system already draws
 * it twice over: `ToolCallBlock` is the locator, the name, the hairline fact line and both
 * payloads, and `CitedAsEvidence` is the reverse link — which problems rest on this call, where
 * this call sits in each of their cases, and every sibling ref selectable so a reader can walk
 * `c3 → c4 → c5` without leaving the transcript. Every other step is `TranscriptDetail`, which is
 * the two remaining layouts — a turn of thought, and the generic one — behind one component.
 */
function Detail({
  step,
  event,
  filed,
  onSelectRef,
}: {
  step: TranscriptStep;
  event: TraceEvent;
  filed: Finding[];
  onSelectRef: (ref: string) => void;
}) {
  if (event.type === "tool.call") {
    const call: ToolCallRecord = {
      ref: event.ref,
      endpoint: event.endpoint,
      tool: event.tool,
      arguments: event.arguments,
      result: event.result,
      latencyMs: event.latencyMs,
      traceSeq: event.seq,
      at: event.at,
    };
    const cited: CitedFinding[] = filed
      .filter((finding) => finding.reproduction.some((called) => called.ref === event.ref))
      .map((finding) => ({
        signature: finding.signature,
        title: finding.title,
        severity: finding.severity,
        refs: finding.reproduction.map((called) => called.ref),
        index: finding.reproduction.findIndex((called) => called.ref === event.ref),
      }));

    return (
      <Stack gap={6}>
        <ToolCallBlock call={call} onSelectRef={onSelectRef} />
        <CitedAsEvidence findings={cited} currentRef={event.ref} onSelectRef={onSelectRef} />
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <TranscriptDetail step={step} detail={event} />
      {/* What a reporter call actually carried. The generic detail layout has no payload of its
          own, and the arguments of a `file_finding` or a `fetch_page` are the step. */}
      {event.type === "reporter.call" ? (
        <PayloadBlock caption="What they sent the reporter" value={JSON.stringify(event.arguments)} />
      ) : null}
    </Stack>
  );
}

export function WatchAVisit() {
  const { wakeId } = useParams();
  const id = wakeId ?? "";
  const [selected, setSelected] = useState<string | null>(null);

  const { href } = useSimulation();
  // A visit still going only says so once. Until it ends, the trace is asked for again at watching
  // rate — the common way into this screen is a person who is "here now" on the live screen, and
  // what they were showing was a frozen snapshot until the reader reloaded the page.
  const wake = useQuery({ ...q.wake(id), refetchInterval: (query) => (query.state.data?.status === "running" ? WATCHING : false) });
  const running = wake.data?.status === "running";
  const trace = useQuery({ ...q.trace(id), refetchInterval: running ? WATCHING : false });
  // THE WAKE'S OWN RUN, not the simulation's latest. A problem the latest execution did not report
  // opens onto the execution that did, and agent ids are deterministic across executions — so the
  // memory panel read from the shell's run answered with somebody's notes from a DIFFERENT one,
  // and the citations came back empty because that run's findings were not in this one's.
  const runId = wake.data?.runId ?? "";
  // The person, not the persona: a wake row knows which persona it ran, and two cohorts may share
  // one. The name at the top of a visit is the name of whoever made it (Decision A).
  const participants = useQuery({ ...q.participants(runId), enabled: runId !== "" });
  const findings = useQuery({ ...q.findings(runId), enabled: runId !== "" });
  const memory = useQuery({
    queryKey: keys.memory(runId, wake.data?.agentId ?? ""),
    queryFn: () => api.memory(runId, wake.data?.agentId ?? ""),
    enabled: wake.data !== undefined,
  });

  /**
   * Stable, so `TranscriptList`'s per-step handler cache survives a poll. Selecting by call ref is
   * how `ToolCallBlock` and `CitedAsEvidence` walk a problem's case from inside the transcript.
   */
  const select = useCallback((next: string) => {
    setSelected(next);
  }, []);

  const wakeData = wake.data;
  const traceData = trace.data;
  const events = useMemo(() => traceData?.items ?? [], [traceData]);
  const mine = useMemo(
    () => (findings.data?.items ?? []).filter((finding) => finding.wakeId === id),
    [findings.data, id],
  );

  const selectRef = useCallback(
    (ref: string) => {
      const target = events.find((event) => event.type === "tool.call" && event.ref === ref);
      // Scrolling the row back into view belongs to `TranscriptList`, which already does it for
      // whatever is selected; all this has to do is say which step that now is.
      if (target !== undefined) setSelected(stepId(target));
    },
    [events],
  );

  /**
   * The rows. Memoised so a two-second poll that returns the same trace builds the same array,
   * and every step's values are primitives so `TranscriptRow`'s own memo holds across the ones
   * that do change.
   */
  const steps = useMemo(() => {
    const severities = new Map(mine.map((finding) => [finding.id, finding.severity]));
    const number = wakeData?.wakeNumber ?? 0;
    return events.map((event) => stepFor(event, number, (findingId) => severities.get(findingId)));
  }, [events, mine, wakeData]);

  const crumbs: Crumb[] = [{ label: "Visits", to: href("visits") }];

  if (wakeData === undefined || traceData === undefined) {
    const state: StateKind = wake.isError
      ? isMissing(wake.error)
        ? "gone"
        : "failed"
      : trace.isError
        ? "failed"
        : "loading";

    return (
      <SplitPage
        header={<PageHeader title="One visit" crumbs={crumbs} />}
        state={state}
        left={null}
        right={null}
        loading={
          <StateBlock
            kind="loading"
            what="this visit"
            skeleton={
              <Stack gap={6} align="stretch">
                <Skeleton variant="block" height={72} label="Reading this visit" />
                <Skeleton variant="row" count={8} height={44} label="Reading the transcript" />
              </Stack>
            }
          />
        }
        gone={
          // The state this screen never had: a visit that is not there is a stale link or a
          // swept execution, and neither is a failure.
          <StateBlock kind="gone" what="this visit">
            There is no visit by that name. A swept execution keeps what its people filed and
            loses their visits. <Link to={href("visits")}>Back to the visits</Link>.
          </StateBlock>
        }
        error={
          <StateBlock kind="failed" what="this visit" error={wake.error ?? trace.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void wake.refetch();
                void trace.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
      />
    );
  }

  const person = personFor(participants.data?.items ?? [], wakeData.agentId);
  const name = person?.name ?? wakeData.personaName;
  // The first call to the app, so the pane is never empty on arrival.
  const fallback = steps.find((step) => step.kind === "tool.call") ?? steps[0];
  const current = steps.find((step) => step.id === selected) ?? fallback;
  const event =
    current === undefined ? undefined : events.find((candidate) => stepId(candidate) === current.id);

  const counts = {
    calls: events.filter((candidate) => candidate.type === "tool.call").length,
    filed: events.filter((candidate) => candidate.type === "finding").length,
    stopped: events.filter((candidate) => candidate.type === "guardrail").length,
    notes: events.filter((candidate) => candidate.type === "memory").length,
  };

  // What they walked back in remembering: the thing nothing else in this category can show.
  const carried = [...(memory.data?.waitingOn ?? []), ...(memory.data?.annoyances ?? [])].filter(
    (entry) => entry.wake < wakeData.wakeNumber,
  );

  const facts: MetaFact[] = [
    { key: "cohort", node: person === undefined ? null : (person.cohortName || person.cohortSlug) },
    { key: "outcome", node: wakeOutcome(wakeData.status) },
    { key: "turns", node: plural(wakeData.turns, "turn") },
    { key: "cost", node: <Money usd={wakeData.costUsd} precision={4} /> },
    { key: "id", node: <Mono size="ref">{wakeData.id}</Mono> },
  ];

  return (
    <SplitPage
      header={
        <PageHeader
          title={`${name}, visit ${String(wakeData.wakeNumber)}`}
          crumbs={[
            ...crumbs,
            ...(person === undefined
              ? []
              : [
                  {
                    label: person.name,
                    to: href(
                      `people/${encodeURIComponent(person.id)}?execution=${encodeURIComponent(wakeData.runId)}`,
                    ),
                  },
                ]),
            { label: `Visit ${String(wakeData.wakeNumber)}` },
          ]}
          meta={facts}
          status={running ? <Chip tone="live">live</Chip> : undefined}
        />
      }
      left={
        <Stack gap={8} align="stretch">
          <StatGroup cols={4} ruled>
            <Stat label="Calls to the app" value={counts.calls} />
            <Stat label="Reports filed" value={counts.filed} />
            <Stat label="Guardrails" value={counts.stopped} />
            <Stat label="Notes written" value={counts.notes} />
          </StatGroup>

          {carried.length === 0 ? null : (
            <Section
              title="What they walked back in remembering"
              trailing={plural(carried.length, "note")}
            >
              <Stack as="ul" gap={2}>
                {carried.map((entry, index) => (
                  <Text
                    as="li"
                    key={`${String(entry.wake)}-${String(index)}`}
                    size="read-sm"
                    tone="soft"
                  >
                    <Inline gap={3} align="baseline">
                      <span className="min-w-0 flex-1">{entry.text}</span>
                      <Text size="meta" tone="muted">
                        {`visit ${String(entry.wake)}`}
                      </Text>
                    </Inline>
                  </Text>
                ))}
              </Stack>
            </Section>
          )}

          <TranscriptList steps={steps} selectedId={current?.id ?? null} onSelect={select} live={running} />
        </Stack>
      }
      right={
        <Card pad="roomy">
          {current === undefined || event === undefined ? (
            <>
              <CardHeader title="Nothing to inspect" level={2} />
              <StateBlock kind="empty" what="this visit">
                This visit recorded no steps. It may have been stopped before it reached the app.
              </StateBlock>
            </>
          ) : (
            <Detail step={current} event={event} filed={mine} onSelectRef={selectRef} />
          )}
        </Card>
      }
    />
  );
}
