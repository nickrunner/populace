import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import {
  AlertDialog,
  Button,
  Chip,
  DocumentPage,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  Measure,
  Mono,
  PageHeader,
  Section,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  WhatWentWrong,
  type StateKind,
} from "../../design/index.js";

/**
 * The targets a project can send people to. One is the normal case and the list is then one row,
 * which is the point of splitting the old single-target screen in two: a project with a staging
 * and a production endpoint is a project with two rows, not two installs (SPEC §7.6).
 *
 * Ported to the design system — ATOMIC-INVENTORY §6.3 row 2. `DocumentPage` owns the reading
 * column and the four empty moments; `Ledger` owns the list. What went with them: the
 * `divide-y divide-rule` card (a hairline per row, and no vertical alignment at all — the spine
 * replaces it), the `block p-3.5 hover:bg-well` row, the hand-written 68ch measure and the
 * `text-accent hover:underline` link.
 */
export function Targets() {
  const { key, project, href } = useProject();
  const queries = useQueryClient();
  const targets = useQuery(q.targets(key));

  // The project overview counts targets and names the one each simulation points at, so a
  // removal that only invalidated the targets list would leave both stale on this very screen.
  const remove = useMutation({
    mutationFn: (id: string) => api.removeTarget(key, id),
    onSuccess: () => queries.invalidateQueries(),
  });
  const removeErrorId = useId();

  const items = targets.data?.items ?? [];
  const usedBy = (id: string): string[] => project.simulations.filter((s) => s.target.id === id).map((s) => s.name);

  /**
   * The state goes to the template's slot rather than returning early, so the header, the reading
   * column and the page frame stay mounted while the body is a sentence.
   */
  const state: StateKind | undefined = targets.isPending
    ? "loading"
    : targets.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  const what = "this project's targets";

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Targets"
          lede="Where the people go. What a target says about itself is what they are told before their first visit, and its tool list is everything they are able to reach."
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what={what}
          skeleton={
            <Skeleton variant="row" count={2} height={76} width="wide" label={`Reading ${what}`} />
          }
        />
      }
      error={
        // A failed read is the one state the reader can act on, so every failed state in the
        // product offers the read again (§6.5, rule 7).
        <StateBlock kind="failed" what={what} error={targets.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void targets.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      empty={
        <StateBlock kind="empty" what={what}>
          Nothing is connected yet. A target is one MCP endpoint and the policy that governs it;
          connect one and the people in this project have somewhere to go.{" "}
          <Link to={href("library/targets/new")} size="ui">
            Connect a target
          </Link>
        </StateBlock>
      }
    >
      <Section
        title="Connected"
        actions={
          <Link to={href("library/targets/new")} size="ui">
            Connect another
          </Link>
        }
      >
        <Ledger>
          {items.map((target, index) => {
            const used = usedBy(target.id);
            return (
              <LedgerRow
                key={target.id}
                stub={
                  <Mono size="ref" tone="muted">
                    {index + 1}
                  </Mono>
                }
                to={href(`library/targets/${encodeURIComponent(target.id)}`)}
                aside={
                  // A target a simulation still names cannot go, and the server's refusal names
                  // the simulation. The control is at a bound rather than gone (§6): it keeps its
                  // tab stop and says why in the dialog it would have opened.
                  used.length > 0 ? (
                    <Button variant="quiet" size="sm" atBound>
                      Remove
                    </Button>
                  ) : (
                    <AlertDialog
                      title={`Remove ${target.name}?`}
                      body={`No simulation points at ${target.name}, so nothing else in this project moves. Executions that have already run keep their visits and their findings — those name the target they went to, and that record does not change.`}
                      confirmLabel="Remove this target"
                      onConfirm={() => {
                        remove.mutate(target.id);
                      }}
                      trigger={
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={remove.isPending}
                          aria-describedby={remove.isError && remove.variables === target.id ? removeErrorId : undefined}
                        >
                          Remove
                        </Button>
                      }
                    />
                  )
                }
              >
                <Stack gap={1}>
                  <Inline gap={3} align="baseline" wrap>
                    <Text size="name">{target.name}</Text>
                    {target.mcp.some((endpoint) => endpoint.authenticated) ? <Chip>Token stored</Chip> : null}
                    <Spacer />
                    <Text size="meta" tone="muted">
                      {used.length === 0 ? "no simulation uses it yet" : `used by ${used.join(", ")}`}
                    </Text>
                  </Inline>

                  {/*
                    The endpoint is the target app naming itself, so it is mono in both themes
                    and it breaks anywhere: a URL is one word to CSS and three lines to a reader.
                    One line each, rather than two spaces between two of them.
                  */}
                  <Stack gap={1}>
                    {target.mcp.map((endpoint) => (
                      <Mono key={endpoint.url} size="code-sm" tone="muted" className="block break-all">
                        {endpoint.url}
                      </Mono>
                    ))}
                  </Stack>

                  {target.description === null || target.description === "" ? null : (
                    <Measure width="read">
                      <Text as="p" size="meta" tone="muted" truncate>
                        {target.description}
                      </Text>
                    </Measure>
                  )}
                </Stack>
              </LedgerRow>
            );
          })}
        </Ledger>

        {remove.isError ? (
          <WhatWentWrong
            id={removeErrorId}
            says="That target was not removed. It is still connected, and nothing about it has changed."
            error={remove.error}
          />
        ) : null}
      </Section>
    </DocumentPage>
  );
}
