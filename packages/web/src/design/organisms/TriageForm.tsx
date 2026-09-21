import { forwardRef, useState } from "react";
import type { TriageInput, TriageView } from "@populace/contract";

import { Button, Input, Text, TextArea, Select, Stack } from "../atoms/index.js";
import { Disclosure, Field, FieldWarning, RelativeTime } from "../molecules/index.js";

/**
 * TriageForm — the human's verdict on a problem (ATOMIC-INVENTORY §3, organism 20).
 *
 * **This is the only place in the product where the word "fixed" is asserted**, and the reason is
 * the whole design: here a *person* is asserting it about their *own* product (§7.3). Everywhere
 * else a problem missing from the newest execution is reported as an absence — *"gone quiet"*,
 * *"not reported"* — because a signature that stops appearing may be a silence in the language
 * rather than a change in the software (ADR-0028 amendment). So the five decisions below are
 * written as first-person sentences: *"We have fixed it"* has an author, and *"fixed"* on its own
 * would not.
 *
 * **The decision is kept against the signature, not against the execution.** That is what makes a
 * longitudinal simulation legible instead of a firehose: without it, execution 40 shows the same
 * forty problems execution 1 showed. The form says so in its own foot, because a reader who does
 * not know that will re-triage the same problem every time they look.
 *
 * **Drift is surfaced before the fold, not inside it.** A signature is a hash of an exact token
 * set; when the current title no longer matches the one the decision was made under, the decision
 * may have been inherited by a different problem wearing the same key. That is worth a reader's
 * attention whether or not they came here to change anything, so it sits outside the disclosure
 * in `FieldWarning`'s `medium` ink — a caution, never an error, and never `role="alert"`.
 *
 * The fold itself is Radix `Collapsible` by way of `Disclosure`, so the trigger carries
 * `aria-expanded` and `aria-controls` that the two bare toggles it replaces never had.
 */

/**
 * The five decisions, in the first person. Copy, not styling.
 *
 * `TriageInput["state"]` is the wire's enum, so a decision this build does not know about is a
 * compile error here rather than a silently unselectable option.
 */
const TRIAGE_WORDS = [
  { value: "untriaged", label: "Not decided yet" },
  { value: "accepted", label: "Accepted — it is real and we will fix it" },
  { value: "fixed", label: "We have fixed it" },
  { value: "wont-fix", label: "We are not going to fix it" },
  { value: "duplicate", label: "Duplicate of something we already track" },
] as const satisfies readonly { value: TriageInput["state"]; label: string }[];

interface Draft {
  state: TriageInput["state"];
  note: string;
  externalRef: string;
}

function draftOf(current: TriageView | null): Draft {
  return {
    state: current?.state ?? "untriaged",
    note: current?.note ?? "",
    externalRef: current?.externalRef ?? "",
  };
}

/** What a draft belongs to. A new signature, or a saved decision, replaces what is in the fields. */
function seedOf(signature: string, current: TriageView | null): string {
  return `${signature}@${current === null ? "none" : current.updatedAt}`;
}

/** The enum, looked up rather than asserted: an unknown value falls back to "not decided yet". */
function decisionOf(value: string): TriageInput["state"] {
  return TRIAGE_WORDS.find((word) => word.value === value)?.value ?? "untriaged";
}

function labelOf(state: TriageInput["state"]): string {
  return TRIAGE_WORDS.find((word) => word.value === state)?.label ?? "Not decided yet";
}

export interface TriageFormProps {
  signature: string;
  current: TriageView | null;
  onSave: (triage: TriageInput) => void;
  /**
   * The signature's title no longer matches the one it was decided under. `TriageView` carries the
   * same flag; the prop is the inventory's signature and it wins, so a screen that knows the
   * decision has drifted for a reason the payload cannot see can still say so.
   */
  drifted: boolean;
}

export const TriageForm = forwardRef<HTMLDivElement, TriageFormProps>(function TriageForm(
  { signature, current, onSave, drifted },
  ref,
) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(current));
  const [seed, setSeed] = useState<string>(() => seedOf(signature, current));

  // Re-seeding during render rather than in an effect: a saved decision comes back as a new
  // `updatedAt`, and the fields must follow it without a second paint showing the stale draft.
  const nextSeed = seedOf(signature, current);
  if (nextSeed !== seed) {
    setSeed(nextSeed);
    setDraft(draftOf(current));
  }

  return (
    <div ref={ref}>
      {drifted ? (
        <FieldWarning>
          {current === null
            ? "This was decided under a different wording. The problem may have been reworded, or this may be a different one wearing the same key."
            : `This was decided under a different wording — “${current.titleAtTriage}”. The problem may have been reworded, or this may be a different one wearing the same key.`}
        </FieldWarning>
      ) : null}

      <Disclosure label={labelOf(draft.state)}>
        <Stack gap={3}>
          <Field label="Your decision">
            {(ids) => (
              <Select
                id={ids.id}
                describedBy={ids.describedBy}
                value={draft.state}
                onChange={(value) => {
                  setDraft({ ...draft, state: decisionOf(value) });
                }}
                options={TRIAGE_WORDS}
              />
            )}
          </Field>

          <Field
            label="Why, or where it is tracked"
            optional
            hint="Anything the next reader would need to know."
          >
            {(ids) => (
              <TextArea
                id={ids.id}
                describedBy={ids.describedBy}
                rows={3}
                value={draft.note}
                onChange={(value) => {
                  setDraft({ ...draft, note: value });
                }}
              />
            )}
          </Field>

          <Field label="Link out" optional hint="An issue, a commit, a ticket — whatever you keep it in.">
            {(ids) => (
              <Input
                id={ids.id}
                describedBy={ids.describedBy}
                mono
                type="url"
                value={draft.externalRef}
                onChange={(value) => {
                  setDraft({ ...draft, externalRef: value });
                }}
              />
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => {
                onSave({
                  signature,
                  state: draft.state,
                  note: draft.note,
                  externalRef: draft.externalRef,
                });
              }}
            >
              Save this decision
            </Button>
            {current === null ? null : (
              <Text size="meta" tone="muted">
                last changed <RelativeTime at={current.updatedAt} />
              </Text>
            )}
          </div>

          <Text as="p" size="read-sm" tone="soft">
            This decision is kept against the problem, not against this execution, so it is still
            here the next time the simulation runs.
          </Text>
        </Stack>
      </Disclosure>
    </div>
  );
});
