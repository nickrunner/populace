import { blockedBecause, effectiveToolPolicy, type ToolPolicy } from "@populace/core/isomorphic";
import { forwardRef, type ReactNode } from "react";

import { Dot, Ring } from "../brand/index.js";
import { Badge, Inline, Measure, Select, Spacer, Stack, Text } from "../atoms/index.js";
import { Field, FieldGrid, TagListField, ToolName } from "../molecules/index.js";
import { Card } from "./Card.js";
import { Ledger, LedgerRow } from "./Ledger.js";

/**
 * ToolPolicyEditor — what anybody sent to a target may touch, and what that leaves them.
 *
 * ATOMIC-INVENTORY §5 names it on two pages and §6.3 rows 22 and 23 say why it is one component:
 * *"the `ToolPolicyEditor` here and in `PersonaEditor` are two divergent implementations of one
 * merge rule — build it once"*. They had already diverged in ways a reader could see. The target's
 * copy listed every tool with its description, its destructive mark and an allowed/blocked chip;
 * the persona's listed bare names with `line-through opacity-50` over the blocked ones — a state
 * carried by a strikethrough and an opacity, which §4.2 does not allow and a greyscale render
 * cannot survive. The target's copy matched the globs on their own; the persona's merged the
 * target's policy underneath first, *and said so*. One of those two was honest about what a
 * person will actually be able to reach, and it was not the one on the screen where the decision
 * is made.
 *
 * So: one editor, one merge, one list.
 *
 * **The merge is the runner's own, not a second implementation of it** (§4.2, ADR-0009).
 * `effectiveToolPolicy` and `blockedBecause` are the functions the wake itself dispatches through:
 * allow lists intersect rather than union — a persona must never be able to widen what the target
 * permits — and the deny list always wins. A browser-side re-derivation of that rule is exactly
 * how a screen comes to promise a reach the runner will refuse.
 *
 * **On the import.** §0.2 keeps `design/` off `@populace/core/isomorphic` so that ADR-0032's seam
 * — the wire speaks the user's words — lives in one package. That rule is about *record
 * vocabulary*: `Agent` is `ParticipantSummaryView`, a wake is a visit. A tool policy has no second
 * vocabulary. `allow`, `deny` and `destructive` are the same three words on both sides, exactly as
 * `ToolCallRecord.ref` is the same `[c3]` in the runner and in the reader's hands, and the
 * alternative to importing the two predicates is writing a second glob matcher in the browser,
 * which is the defect this component exists to end. `@populace/contract` does not re-export them
 * today; if it does one day, this import moves and nothing else about the component changes.
 *
 * **Blocked is drawn as an absence and said as a word.** The stub carries the mark grammar — a
 * filled dot for a tool they can reach, an empty ring for one they cannot (§1.2 M4) — and the row
 * carries the word *blocked* and the reason the runner would give. Neither channel alone is the
 * state.
 */

/**
 * What this editor needs to know about a tool, which is less than any one caller holds. A target's
 * check returns a description, an endpoint and a `readOnly` flag as well; a persona editing against
 * a simulation's pre-flight has only names. Both are this, and a list of names is not a poorer
 * version of a checked tool — it is what is known before anybody has asked.
 */
export interface PolicyTool {
  name: string;
  /** What the target says the tool does. Absent where only the name list is known. */
  description?: string;
  /** The target marks it destructive (MCP `destructiveHint`). */
  destructive?: boolean;
}

/** The destructive setting in the words both forms use for it, for saying which one wins. */
const DESTRUCTIVE_WORDS: Record<ToolPolicy["destructive"], string> = {
  allow: "let them do it",
  confirm: "ask them to confirm first",
  deny: "never",
};

const DESTRUCTIVE_OPTIONS = [
  { value: "confirm", label: "Ask them to confirm first (recommended)" },
  { value: "allow", label: "Let them do it" },
  { value: "deny", label: "Never" },
] as const;

export interface ToolPolicyEditorProps {
  /** The policy being edited. */
  policy: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  /**
   * The policy this one is merged onto — the target's, beneath a persona's. Null where this IS
   * the floor. It is never editable here; it is only ever applied, and named.
   */
  floor?: ToolPolicy | null;
  /** Every tool the target exposes, or null while nobody has asked it. */
  tools: readonly PolicyTool[] | null;
  /** The sentence above the globs, in the caller's own words. */
  lede?: ReactNode;
  allowPlaceholder?: string;
  denyPlaceholder?: string;
  /** Standing guidance under the destructive setting, where the merge has nothing to say. */
  destructiveHint?: ReactNode;
  /** A control that goes and asks the target for its tool list. */
  action?: ReactNode;
  /** What to say where there is no tool list to match against yet. */
  whenUnknown: ReactNode;
}

export const ToolPolicyEditor = forwardRef<HTMLElement, ToolPolicyEditorProps>(
  function ToolPolicyEditor(
    {
      policy,
      onChange,
      floor = null,
      tools,
      lede,
      allowPlaceholder,
      denyPlaceholder,
      destructiveHint,
      action,
      whenUnknown,
    },
    ref,
  ) {
    const effective = effectiveToolPolicy(...(floor === null ? [policy] : [floor, policy]));
    const reachable =
      tools === null ? 0 : tools.filter((tool) => blockedBecause(tool.name, effective) === null).length;
    const narrowed = floor !== null && (floor.allow.length > 0 || floor.deny.length > 0);

    return (
      <Card ref={ref}>
        <Stack gap={6}>
          {lede === undefined ? null : (
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                {lede}
              </Text>
            </Measure>
          )}

          <FieldGrid cols={2}>
            <TagListField
              label="Allow"
              hint="Empty means everything the target exposes."
              value={policy.allow}
              onChange={(allow) => {
                onChange({ ...policy, allow });
              }}
              placeholder={allowPlaceholder}
            />
            <TagListField
              label="Deny"
              hint="Always wins over allow, on every persona."
              value={policy.deny}
              onChange={(deny) => {
                onChange({ ...policy, deny });
              }}
              placeholder={denyPlaceholder}
            />
          </FieldGrid>

          {/*
            The runner takes the STRICTER of the two, so a persona that says "let them do it"
            against a target that says "confirm" gets confirm — and a screen showing the persona's
            own word alone would read as if people will act freely when they will not.
          */}
          <Field
            label="Tools the target marks destructive"
            hint={
              effective.destructive === policy.destructive
                ? destructiveHint
                : `The target says "${DESTRUCTIVE_WORDS[effective.destructive]}", and the stricter of the two is what happens — so this is what they will actually do, whatever is picked here.`
            }
          >
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={policy.destructive}
                onChange={(next) => {
                  const picked = DESTRUCTIVE_OPTIONS.find((option) => option.value === next);
                  if (picked !== undefined) onChange({ ...policy, destructive: picked.value });
                }}
                options={DESTRUCTIVE_OPTIONS}
              />
            )}
          </Field>

          <Stack gap={3}>
            <Inline gap={3} align="baseline" wrap>
              <Text size="label" tone="muted">
                What that leaves them
              </Text>
              {tools === null ? null : (
                <Text size="meta" tone="muted">
                  {reachable} of {tools.length} tools reachable
                </Text>
              )}
              <Spacer />
              {action}
            </Inline>

            {tools === null || tools.length === 0 ? (
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  {whenUnknown}
                </Text>
              </Measure>
            ) : (
              <Ledger as="ul" stubKind="mark" stubLabel="Reach">
                {tools.map((tool) => {
                  const why = blockedBecause(tool.name, effective);
                  return (
                    <LedgerRow
                      key={tool.name}
                      stub={
                        why === null ? (
                          <Dot state="present" label="reachable" />
                        ) : (
                          <Ring label="blocked" />
                        )
                      }
                    >
                      <Inline gap={3} align="baseline" wrap>
                        <ToolName name={tool.name} />
                        {tool.description === undefined || tool.description === "" ? null : (
                          <Text size="meta" tone="muted" truncate>
                            {tool.description}
                          </Text>
                        )}
                        <Spacer />
                        {tool.destructive === true ? <Badge tone="warn">destructive</Badge> : null}
                        {why === null ? (
                          <Badge tone="good">allowed</Badge>
                        ) : (
                          <>
                            <Badge tone="bad">blocked</Badge>
                            <Text size="meta" tone="muted">
                              {why}
                            </Text>
                          </>
                        )}
                      </Inline>
                    </LedgerRow>
                  );
                })}
              </Ledger>
            )}

            {narrowed ? (
              <Text as="p" size="meta" tone="muted">
                The target has a policy of its own, and it is applied first: this can take more
                away, never put anything back.
              </Text>
            ) : null}
          </Stack>
        </Stack>
      </Card>
    );
  },
);
