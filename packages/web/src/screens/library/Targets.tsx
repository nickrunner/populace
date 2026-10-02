import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";

import type { StoredTargetView } from "@populace/contract";
import { api } from "../../api.js";
import { keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  AlertDialog,
  Button,
  Chip,
  DocumentPage,
  DropdownMenu,
  IconButton,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  Mono,
  PageHeader,
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
 *
 * **A list page like every other noun's** (ADR-0043). The row is the target's page, the aside is
 * one menu with Edit and Delete, the header's one act is "Connect a target", and the row says the
 * two facts a target is made of — its address and how people get accounts there — and nothing a
 * reader would have to open it to find out. Which studies point at it is said where it matters:
 * in the Delete item, which is at a bound while any do.
 */
export function Targets() {
  const { key, href } = useProject();
  const targets = useQuery(q.targets(key));
  const removeErrorId = useId();

  /**
   * The state goes to the template's slot rather than returning early, so the header, the reading
   * column and the page frame stay mounted while the body is a sentence.
   */
  const items = targets.data?.items ?? [];
  const state: StateKind | undefined = targets.isPending
    ? "loading"
    : targets.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  const what = "this project's targets";
  /** The one thing that failed, for the sentence under the list; the rows each own their dialog. */
  const [failed, setFailed] = useState<{ name: string; error: Error } | null>(null);

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Targets"
          lede="Where the people go. What a target says about itself is what they are told before their first visit, and its tool list is everything they are able to reach."
          actions={
            <Button asChild variant="primary">
              <RouterLink to={href("library/targets/new")}>Connect a target</RouterLink>
            </Button>
          }
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
      <Stack gap={4}>
        <Ledger stubLabel="Target">
          {items.map((target, index) => (
            <TargetRow
              key={target.id}
              target={target}
              position={index + 1}
              errorId={removeErrorId}
              onFailed={(error) => {
                setFailed({ name: target.name, error });
              }}
              onRemoved={() => {
                setFailed(null);
              }}
            />
          ))}
        </Ledger>

        {failed === null ? null : (
          <WhatWentWrong
            id={removeErrorId}
            says={`${failed.name} was not deleted. It is still connected, and nothing about it has changed.`}
            error={failed.error}
          />
        )}
      </Stack>
    </DocumentPage>
  );
}

/**
 * One target: its name, its address, and how people get accounts there.
 *
 * A row rather than a map body because the aside owns state — the menu's Delete item opens a
 * CONTROLLED `AlertDialog` that is a sibling of the menu, never inside the item, because Radix
 * unmounts the item on select and would take the dialog with it (ATOMIC-INVENTORY §3, organism 4
 * amendment). One dialog per row is one `useState` per row, which is what a component is for.
 */
function TargetRow({
  target,
  position,
  errorId,
  onFailed,
  onRemoved,
}: {
  target: StoredTargetView;
  position: number;
  errorId: string;
  onFailed: (error: Error) => void;
  onRemoved: () => void;
}) {
  const { key, project, href } = useProject();
  const queries = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  /**
   * How many studies point at it, from the overview this page already holds. The server refuses
   * the delete while any do and names them; saying so here, before the dialog, is what keeps the
   * refusal from being the first the reader hears of it.
   */
  const pointedAtBy = project.targets.find((row) => row.id === target.id)?.studies ?? 0;
  const held = pointedAtBy > 0;

  // The project overview counts targets and names the one each study points at, and the setup
  // needs say whether there is a target at all, so a removal that only invalidated the targets
  // list would leave both stale on this very screen and on the rail beside it. Specific keys,
  // never a bare invalidation (ADR-0043).
  const remove = useMutation({
    mutationFn: () => api.removeTarget(key, target.id),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.targets(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
      setConfirming(false);
      onRemoved();
    },
    onError: (error) => {
      setConfirming(false);
      onFailed(error);
    },
  });

  const page = href(`library/targets/${encodeURIComponent(target.id)}`);
  const unfinished = target.identity.strategy === "undecided";

  return (
    <LedgerRow
      stub={
        <Mono size="ref" tone="muted">
          {position}
        </Mono>
      }
      to={page}
      aside={
        <>
          <DropdownMenu
            label={`${target.name} actions`}
            trigger={
              <IconButton
                icon="chevron-down"
                label={`Actions for ${target.name}`}
                size="sm"
                aria-describedby={remove.isError ? errorId : undefined}
              />
            }
            items={[
              { label: "Edit", to: page },
              {
                // At a bound, not gone (§6): the item keeps its place and says why in its own
                // label, which is the reason the server would give.
                label: held ? `Delete — ${plural(pointedAtBy, "study", "studies")} point${pointedAtBy === 1 ? "s" : ""} at it` : "Delete",
                tone: "danger",
                disabled: held || remove.isPending,
                onSelect: () => {
                  setConfirming(true);
                },
              },
            ]}
          />
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${target.name}?`}
            body={`No study points at ${target.name}, so nothing else in this project moves. Executions that have already run keep their visits and their findings — those name the target they went to, and that record does not change.`}
            confirmLabel="Delete this target"
            confirmPending={remove.isPending}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        </>
      }
    >
      <Stack gap={1}>
        <Inline gap={3} align="baseline" wrap>
          <Text size="name">{target.name}</Text>
          {/*
            Connected and not finished (ADR-0040). Connecting writes the target the moment a
            check gets through, so a row that nobody answered the last question on is now an
            ordinary way to leave the connect screen — and it must not sit in this list looking
            like a target anybody can send people to. `warn` and not `bad`: nothing is broken,
            one question is open, and the row is the way to it.
          */}
          {unfinished ? <Chip tone="warn">Unfinished</Chip> : null}
          {target.mcp.some((endpoint) => endpoint.authenticated) ? <Chip>Token stored</Chip> : null}
          <Spacer />
          <Text size="meta" tone="muted">
            {wayInFact(target.identity.strategy)}
          </Text>
        </Inline>

        {/*
          The endpoint is the target app naming itself, so it is mono in both themes and it
          breaks anywhere: a URL is one word to CSS and three lines to a reader. One line each,
          rather than two spaces between two of them.
        */}
        <Stack gap={1}>
          {target.mcp.map((endpoint) => (
            <Mono key={endpoint.url} size="code-sm" tone="muted" className="block break-all">
              {endpoint.url}
            </Mono>
          ))}
        </Stack>
      </Stack>
    </LedgerRow>
  );
}

/**
 * The way in, as the row's one fact about it, in the words the connect screen's radios use
 * (ADR-0038): an answer about the product, never a mechanism's name.
 */
function wayInFact(strategy: StoredTargetView["identity"]["strategy"]): string {
  switch (strategy) {
    case "undecided":
      return "how people get accounts is not answered yet";
    case "provision-url":
      return "your app makes their accounts";
    case "self-signup":
      return "they sign themselves up";
    case "none":
      return "nobody needs an account";
    case "static":
      return "accounts you already have";
    case "admin-mint":
      return "minted with a Firebase service account";
  }
}
