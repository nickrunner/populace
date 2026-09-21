import type { TargetCheck } from "@populace/contract";
import { forwardRef } from "react";

import { Badge, Button, Inline, Mono, Spacer, Stack, Tooltip } from "../atoms/index.js";
import { Duration, MetaLine, type MetaFact } from "../molecules/index.js";
import { PayloadBlock } from "./PayloadBlock.js";
import { WhatWentWrong } from "./WhatWentWrong.js";

/**
 * ConnectionStatusBar — what the target says about itself right now, in one line.
 *
 * ATOMIC-INVENTORY §6.3 row 22: the target screen carries **four renderings of connection state**
 * — a sentence for *not checked yet*, a chip plus three loose spans for *connected*, a second chip
 * for *could not connect*, and a stack of error strips underneath — each with its own type step
 * and its own idea of where the check control goes. They are one state with four spellings, and a
 * reader learning where to look learns it four times.
 *
 * **The state is always a word** (§4.2): *not checked yet*, *connected*, *could not connect*. The
 * `Badge` carries the word and the tone together; neither is the state on its own.
 *
 * **The facts are hairline-separated, not middle-dotted** (§4.5), and they are only the facts the
 * check actually returned — a latency, the server naming itself, how many tools it offered. A
 * check that came back without a server name shows no server, rather than an empty gap where one
 * would be.
 *
 * **Two kinds of failure, kept apart.** `check.errors` is the target's own words about what it
 * could not do, so they go in the evidence well, verbatim, in the machine's face (§4.3). A
 * `failure` is *our* request never landing, which is the product's sentence plus the machine's
 * words beneath it — `WhatWentWrong`, the one component for that pair (§7.4).
 *
 * **The control stays where it is in every state.** Where a check cannot be run yet the button is
 * at a bound rather than gone: it keeps its tab stop and its tooltip and says why (§6).
 */

export interface ConnectionStatusBarProps {
  /** The last check, or null while nobody has asked. */
  check: TargetCheck | null;
  /** A check is in flight. */
  checking: boolean;
  onCheck: () => void;
  /** Why a check cannot be asked for yet. The control stays, at a bound, and says this. */
  blocked?: string;
  /** Our own request failing, as opposed to the target's answer. */
  failure?: Error | null;
}

export const ConnectionStatusBar = forwardRef<HTMLElement, ConnectionStatusBarProps>(
  function ConnectionStatusBar({ check, checking, onCheck, blocked, failure = null }, ref) {
    const facts: MetaFact[] = [];
    if (check !== null && check.ok) {
      if (check.latencyMs !== null) {
        facts.push({ key: "latency", node: <Duration ms={check.latencyMs} /> });
      }
      if (check.server !== null) {
        facts.push({
          key: "server",
          node: (
            <Mono size="code-sm">
              {check.server.name} {check.server.version}
            </Mono>
          ),
        });
      }
      facts.push({
        key: "tools",
        node: `${check.tools.length} ${check.tools.length === 1 ? "tool" : "tools"}`,
      });
    }

    const control = (
      <Button
        variant="secondary"
        onClick={onCheck}
        pending={checking}
        atBound={blocked !== undefined}
      >
        {check === null ? "Check the connection" : "Check again"}
      </Button>
    );

    return (
      <Stack ref={ref} gap={4}>
        <Inline gap={3} align="center" wrap>
          {check === null ? (
            <Badge>not checked yet</Badge>
          ) : check.ok ? (
            <Badge tone="good">connected</Badge>
          ) : (
            <Badge tone="bad">could not connect</Badge>
          )}
          {facts.length === 0 ? null : <MetaLine facts={facts} />}
          <Spacer />
          {/*
            At a bound the control keeps its tab stop and its name, and the reason is a `Tooltip`
            rather than a `title=` attribute — a native tooltip reaches no screen reader and no
            keyboard (§1 atom 30).
          */}
          {blocked === undefined ? control : <Tooltip content={blocked}>{control}</Tooltip>}
        </Inline>

        {check !== null && check.errors.length > 0 ? (
          <PayloadBlock caption="What came back" value={check.errors.join("\n")} error />
        ) : null}

        {failure === null ? null : (
          <WhatWentWrong
            says="The check never reached the target. Nothing about the target has changed, and you can ask again."
            error={failure}
          />
        )}
      </Stack>
    );
  },
);
