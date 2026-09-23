import type { FirstContact } from "@populace/contract";
import { forwardRef } from "react";

import { Badge, Button, Inline, Measure, Spacer, Stack, Text, Tooltip } from "../atoms/index.js";
import { Duration, FieldWarning, MetaLine, RelativeTime, ToolName, type MetaFact } from "../molecules/index.js";
import { Card } from "./Card.js";
import { PayloadBlock } from "./PayloadBlock.js";
import { WhatWentWrong } from "./WhatWentWrong.js";

/**
 * FirstContactPanel — "does any of this actually work?", which is the one thing the form above it
 * cannot answer.
 *
 * It makes ONE account the configured way, calls ONE read-only tool with it and takes the account
 * back down, then says which of the six things happened. **It calls no model, so it costs
 * nothing** — which is the whole point of being able to run it before an execution does, and why
 * the act is an ordinary button rather than a `ConfirmButton`: nothing here spends.
 *
 * **The outcome is a word** (§4.2), and the tone never carries it alone. Two of the six outcomes
 * are neither good nor bad — the endpoint answered but nothing was called; the account was made
 * and the tool it tried then failed — and a two-colour reading of six states would have to lie
 * about one of them.
 *
 * **The target's own words go in the well** (§4.3): `detail` is whatever the provider or the
 * product said, quoted verbatim in the machine's face, never paraphrased into the product's voice.
 * A request that never landed is the other kind of failure and goes through `WhatWentWrong`.
 *
 * **An account left behind is a warning, and it names the account.** Sweep works from the run tag;
 * an account this check could not remove is one a person has to go and remove, so the handle is on
 * the page rather than in a log.
 *
 * Nothing here promises what a future execution will find (§7.3). One person got in, or did not.
 */

/**
 * The six outcomes, in the words the reader gets.
 *
 * Exported because the project dashboard's Targets band reports the same stored result, and two
 * tables of six words drift the day somebody edits one of them. The band shows the word and this
 * panel shows the word plus the detail; neither invents a seventh.
 */
export const OUTCOME_WORDS: Record<FirstContact["outcome"], string> = {
  accepted: "they can get in",
  "connected-only": "connected, nothing called",
  "tool-failed": "got in; the tool failed",
  // "the credential" and not "the account": on a target with no accounts (ADR-0038) nobody was
  // made, and what was refused is whatever the ADDRESS carries. The word has to be true of all
  // five ways in, because this table is one table and the summary beneath names the account
  // whenever there is one.
  rejected: "the target refused the credential",
  "provision-failed": "no account could be made",
  unreachable: "could not reach it",
};

/** `good` where a population would get through the front door, `bad` where it would not. */
export const OUTCOME_TONES: Record<FirstContact["outcome"], "good" | "neutral" | "bad"> = {
  accepted: "good",
  "connected-only": "neutral",
  "tool-failed": "neutral",
  rejected: "bad",
  "provision-failed": "bad",
  unreachable: "bad",
};

export interface FirstContactPanelProps {
  /** The target has been saved. A check runs against the stored target, so it cannot run before. */
  saved: boolean;
  /** The last check — this session's, or the one stored on the target. Null if nobody has run one. */
  result: FirstContact | null;
  running: boolean;
  /** Our own request failing, as opposed to the check reporting a failure. */
  error: Error | null;
  onRun: () => void;
  /**
   * False when this target makes nobody — the way in is "they don't need one" (ADR-0038).
   *
   * The resting copy promises an account: *"Makes one account the way you have set it up… and
   * removes the account again."* On a target with no accounts that is a promise the check will
   * not keep, and the sentence a reader has just read on the form said the opposite. What the
   * check does there is still worth a button, and it is a smaller thing: one call, with whatever
   * the address itself carries.
   */
  makesAnAccount?: boolean;
}

export const FirstContactPanel = forwardRef<HTMLElement, FirstContactPanelProps>(
  function FirstContactPanel({ saved, result, running, error, onRun, makesAnAccount = true }, ref) {
    const facts: MetaFact[] = [];
    if (result !== null) {
      if (result.handle !== null) facts.push({ key: "account", node: `account ${result.handle}` });
      if (result.tool !== null) {
        facts.push({
          key: "tool",
          node: (
            <>
              answered by <ToolName name={result.tool} />
            </>
          ),
        });
      }
      if (result.latencyMs !== null) {
        facts.push({ key: "latency", node: <Duration ms={result.latencyMs} /> });
      }
      facts.push({
        key: "teardown",
        node: result.tornDown ? "the account was removed again" : "nothing was removed",
      });
      facts.push({ key: "when", node: <RelativeTime at={result.checkedAt} mode="ago" /> });
    }

    const control = (
      <Button variant="secondary" onClick={onRun} pending={running} atBound={!saved}>
        {result === null ? "Try it for real" : "Try it again"}
      </Button>
    );

    return (
      <Stack ref={ref} gap={4}>
        <Inline gap={3} align="baseline" wrap>
          <Text size="label" tone="muted">
            First contact
          </Text>
          {result === null ? null : (
            <Badge tone={OUTCOME_TONES[result.outcome]}>{OUTCOME_WORDS[result.outcome]}</Badge>
          )}
          <Spacer />
          {saved ? (
            control
          ) : (
            <Tooltip content="Save the target first — the check runs against what is stored.">
              {control}
            </Tooltip>
          )}
        </Inline>

        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            {makesAnAccount
              ? "Makes one account the way you have set it up, calls one read-only tool with it, and removes the account again."
              : "Nobody needs an account here, so nobody is made: it connects with whatever the address itself carries and calls one read-only tool."}
            {" It calls no model, so it costs nothing —"}
            {saved
              ? " and it is the only way to find out before an execution does."
              : " save the target first."}
          </Text>
        </Measure>

        {error === null ? null : (
          <WhatWentWrong
            says="The check never ran. Nothing was created on the target, and you can try again."
            error={error}
          />
        )}

        {result === null ? null : (
          <Card tone="sunk" pad="tight">
            <Stack gap={3}>
              <Measure width="read">
                <Text as="p" size="read">
                  {result.summary}
                </Text>
              </Measure>
              {result.detail === null ? null : (
                <PayloadBlock caption="What came back" value={result.detail} />
              )}
              <MetaLine facts={facts} />
              {result.leftBehind === null ? null : (
                <FieldWarning>
                  An account was left on the target: {result.leftBehind.handle}.{" "}
                  {result.leftBehind.why}
                </FieldWarning>
              )}
            </Stack>
          </Card>
        )}
      </Stack>
    );
  },
);
