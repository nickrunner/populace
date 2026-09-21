import { useQuery } from "@tanstack/react-query";
import type { ToolUsageView } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { plural } from "../format.js";
import {
  Button,
  ClusterRow,
  DataTable,
  Inline,
  InstrumentPage,
  Ledger,
  LedgerRow,
  Link,
  Meter,
  MetaLine,
  PageHeader,
  RelativeTime,
  Section,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  ToolName,
  type Column,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

type Tool = ToolUsageView["items"][number];

/**
 * The part of the report about what to build next rather than what to fix. Three halves, and the
 * middle one is new: what people came to do and found no way to do, how the tools you do expose
 * were actually used, and the ones nobody reached for at all.
 *
 * It names nobody. A coverage gap is a fact about the product's surface and about how many people
 * in which cohorts wanted it; who said it is on the problem's own page, one click away, where a
 * name is attribution rather than decoration (SPEC §7.1).
 *
 * **Instrument-class** (DESIGN-SYSTEM §5.3): the full page width, no reading measure, `t-ui`
 * chrome and the stub carried down the left of both lists as a leading column.
 *
 * **The usage distribution is drawn** (ATOMIC-INVENTORY §6.3, row 8). `coverage.items[].calls`
 * arrives for every tool and the screen used to reduce it to a column of literal `0`s, which
 * said nothing about the shape of the thing: forty calls to one tool and one call to another is
 * the fact that makes a never-called tool interesting. So the tools that were called are a
 * `Meter` each, against the busiest one, and the tools that were not are the table below —
 * which no longer carries a column of zeroes, because the zero is the reason the row is there.
 *
 * **A meter is not allowed inside a table cell** (§1.3 rule 10: cells hold values, no lattice, no
 * capsule, no bar), so the distribution is a `Ledger` and the untouched list is the `DataTable`.
 * That split is also the screen's two questions kept apart: what they used, and what they never
 * touched.
 *
 * **A tool that was called but is no longer listed keeps its name.** `ToolName missing` prints it
 * in full and says `— not exposed` beside it, replacing the `line-through opacity-50` the old
 * screen wore: evidence is not decorated away, and colour-and-texture alone is not a statement
 * (§4.2).
 *
 * **Nothing on this screen is marked** (§5.4, appearance 4, which names the screens by hand and
 * ends "Visits / Compare / Gaps → nothing, those screens have no single answer and get none").
 * The port lit the gap the most people wanted, which is a fourth question — *which one should we
 * build?* — that this screen has no standing to answer: the three lists are what was wanted,
 * what was used and what was never touched, and a lime band on one row of the first would read
 * as the product's recommendation.
 */
export function Gaps() {
  const { key, href: projectHref } = useProject();
  const { key: sim, href } = useSimulation();
  const results = useQuery(q.results(key, sim));

  const data = results.data;

  if (data === undefined) {
    const state: StateKind = results.isPending ? "loading" : "failed";
    return (
      <InstrumentPage
        header={<PageHeader title="Coverage gaps" lede={LEDE} />}
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="the coverage gaps"
            skeleton={<Skeleton variant="row" count={6} label="Reading the coverage gaps" />}
          />
        }
        error={
          // A failed read is the one state the reader can act on, so every failed state in the
          // product offers the read again (§6.5, rule 7). The tool-list failure further down is
          // NOT this state: the target answered nothing about its own tools, which is a fact
          // about the target rather than a read this screen can repeat.
          <StateBlock kind="failed" what="the coverage gaps" error={results.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void results.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
      >
        {null}
      </InstrumentPage>
    );
  }

  const gaps = [...data.clusters, ...data.known].filter((card) => card.kind === "coverage-gap");
  // Which execution these results are of, so a problem that came back can name the one it came
  // back in. `execution` is a run detail and carries no sequence number; `history` is where the
  // run id and its `seq` are the same row.
  const execution = data.execution;
  const currentSeq =
    execution === null
      ? undefined
      : data.history.find((entry) => entry.runId === execution.id)?.seq;
  const called = data.coverage.items
    .filter((tool) => tool.calls > 0)
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  const untouched = data.coverage.items
    .filter((tool) => tool.exposed && tool.calls === 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const busiest = called[0]?.calls ?? 0;
  const totalCalls = called.reduce((sum, tool) => sum + tool.calls, 0);
  const position = new Map(untouched.map((tool, index) => [tool.name, index + 1]));

  const facts: readonly MetaFact[] =
    data.coverage.toolsError !== null
      ? [{ key: "calls", node: plural(totalCalls, "call") }]
      : [
          { key: "exposed", node: `${plural(data.coverage.exposedCount, "tool")} exposed` },
          { key: "untouched", node: `${untouched.length} never called` },
          { key: "calls", node: plural(totalCalls, "call") },
        ];

  const columns: Column<Tool>[] = [
    { key: "tool", header: "Tool", cell: (tool) => <ToolName name={tool.name} /> },
    {
      // The one serif column (§5.3): a phrase a reader scans down, not a value.
      key: "noting",
      header: "Also worth noting",
      sentence: true,
      cell: (tool) => (
        <Text size="read-sm" tone="soft">
          {tool.destructive
            ? "destructive, so nobody was allowed to try it"
            : "never discovered, never asked for"}
        </Text>
      ),
    },
  ];

  return (
    <InstrumentPage
      header={<PageHeader title="Coverage gaps" lede={LEDE} meta={facts} />}
      state={execution === null ? "empty" : undefined}
      empty={
        <StateBlock kind="empty" what="the coverage gaps">
          Nobody has been sent to this target yet, so there is nothing yet to say about what
          they could not do.{" "}
          <Link to={href("preflight")}>Look it over before you send them in.</Link>
        </StateBlock>
      }
    >
      <Stack gap={8} align="stretch">
        <Section
          title="What people could not do"
          trailing={gaps.length === 0 ? undefined : plural(gaps.length, "gap")}
        >
          {gaps.length === 0 ? (
            <StateBlock kind="empty" what="the coverage gaps">
              Nobody went looking for a tool that is not there.
            </StateBlock>
          ) : (
            <Ledger>
              {gaps.map((card) => (
                <ClusterRow
                  key={card.signature}
                  cluster={card}
                  to={href(`f/${encodeURIComponent(card.signature)}`)}
                  currentSeq={currentSeq}
                />
              ))}
            </Ledger>
          )}
        </Section>

        <Section
          title="How your tools were used"
          trailing={
            called.length === 0
              ? undefined
              : `${plural(totalCalls, "call")} to ${plural(called.length, "tool")}`
          }
        >
          {called.length === 0 ? (
            <StateBlock kind="empty" what="the tool calls">
              Nobody called a tool on this target. The visits are where to look next.
            </StateBlock>
          ) : (
            <Ledger stubLabel="Rank">
              {called.map((tool, index) => (
                <LedgerRow
                  key={tool.name}
                  stub={
                    <Text as="div" size="meta" tone="muted" className="md:text-right">
                      {index + 1}
                    </Text>
                  }
                >
                  <Stack gap={2}>
                    <Inline gap={3} align="baseline" wrap>
                      <ToolName name={tool.name} missing={!tool.exposed} />
                      <Spacer />
                      <MetaLine facts={usageFacts(tool)} />
                    </Inline>
                    <Meter
                      size="sm"
                      value={tool.calls}
                      of={busiest}
                      label={`${tool.name} took ${plural(tool.calls, "call")}; the most-called tool took ${plural(busiest, "call")}.`}
                    />
                  </Stack>
                </LedgerRow>
              ))}
            </Ledger>
          )}
        </Section>

        <Section
          title="Tools you expose that nobody reached for"
          trailing={
            data.coverage.toolsError !== null
              ? undefined
              : `${untouched.length} of ${data.coverage.exposedCount}`
          }
        >
          {data.coverage.toolsError !== null ? (
            <StateBlock
              kind="failed"
              what="your target's tool list"
              error={new Error(data.coverage.toolsError)}
            >
              The target could not be reached, so we cannot say which of its tools went
              untouched — only the ones somebody called are listed above.{" "}
              <Link to={projectHref("library/target")}>Open the target</Link> to check the
              connection.
            </StateBlock>
          ) : (
            <DataTable<Tool>
              rows={untouched}
              keyOf={(tool) => tool.name}
              stub={(tool) => position.get(tool.name)}
              caption="Tools this target exposes that nobody called in this execution"
              empty="Every tool you expose was called at least once."
              columns={columns}
            />
          )}
        </Section>
      </Stack>
    </InstrumentPage>
  );
}

/** The screen's own sentence, and the only place it is written. */
const LEDE =
  "What people came here to do and found no way to do. This is the part of the report that is about what to build next rather than what to fix.";

/**
 * What a called tool's row says beside its bar. Errors take the critical ink and the word
 * together — the ink is never the whole statement (§4.2) — and a tool that has never errored
 * says nothing at all rather than printing a zero.
 */
function usageFacts(tool: Tool): readonly MetaFact[] {
  return [
    { key: "calls", node: plural(tool.calls, "call") },
    {
      key: "errors",
      node:
        tool.errors === 0 ? null : (
          <Text size="meta" tone="critical">
            {`${plural(tool.errors, "call")} errored`}
          </Text>
        ),
    },
    {
      key: "last",
      node: (
        <>
          last called <RelativeTime at={tool.lastUsedAt} />
        </>
      ),
    },
  ];
}
