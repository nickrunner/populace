import { forwardRef, useId } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { ExecutionHistoryEntry } from "@populace/contract";

import { when } from "../../format.js";
import { Button, Inline, Label, Select, type SelectOption } from "../atoms/index.js";
import { FieldWarning } from "../molecules/index.js";

/**
 * ExecutionPicker — pick any two executions and put them side by side (ATOMIC-INVENTORY §3,
 * organism 34).
 *
 * **AMENDED, and this file is the amendment.** The plan named `ExecutionPicker` a principal
 * organism of `Executions` (§5 page 20, §6.3 row 9) and then left it out of the §3 organism
 * table, so the port hand-rolled it inside the screen. `Compare` (§6.3 row 21) needs the same
 * control — a reader who has two executions side by side changes which two from there, not by
 * going back a screen — and a second hand-rolled copy is how the product ends up with two
 * spellings of one guard. So it is an organism, here, once. §3 now lists it.
 *
 * **The guard is the point.** A comparison of an execution with itself is not a comparison, so
 * the act is unavailable until the two differ, and the warning says which two are wanted rather
 * than letting the compare screen explain it after the click.
 *
 * **It knows nothing about routes.** The caller passes `to` — already composed from its own `a`
 * and `b` — because where a comparison lives is the app's business and a design organism that
 * built the path would have to know which simulation it was inside.
 *
 * Nothing here says the two executions ought to agree. They are independent by design (§7.3): the
 * screens either side of this control carry that sentence, and this control does not contradict
 * it by calling the act a check.
 */
export interface ExecutionPickerProps {
  /** What there is to choose between, in the order the list is read — newest first. */
  executions: readonly ExecutionHistoryEntry[];
  /** The earlier execution's run id. */
  a: string;
  /** The later execution's run id. */
  b: string;
  onA: (runId: string) => void;
  onB: (runId: string) => void;
  /** Where the act goes for the two currently chosen. Ignored while they are the same one. */
  to: string;
}

export const ExecutionPicker = forwardRef<HTMLDivElement, ExecutionPickerProps>(
  function ExecutionPicker({ executions, a, b, onA, onB, to }, ref) {
    const earlier = useId();
    const later = useId();
    const same = a === b;

    const options: SelectOption[] = executions.map((entry) => ({
      value: entry.runId,
      label: `execution ${String(entry.seq)} — ${entry.startedAt === null ? "never started" : when(entry.startedAt)}`,
    }));

    return (
      <div ref={ref} className="contents">
        <Inline gap={2} align="center">
          {/* No `aria-label` beside a visible `<Label>`: it would override the words a speech
              -input user can see and say, which is WCAG 2.5.3 (label in name). The visible
              caption is the control's name, and `htmlFor` is what makes it one. */}
          <Label htmlFor={earlier}>Earlier</Label>
          <Select
            id={earlier}
            size="sm"
            value={a}
            onChange={onA}
            options={options}
            className="w-auto min-w-56"
          />
        </Inline>

        <Inline gap={2} align="center">
          <Label htmlFor={later}>Later</Label>
          <Select
            id={later}
            size="sm"
            value={b}
            onChange={onB}
            options={options}
            className="w-auto min-w-56"
          />
        </Inline>

        {same ? (
          <Button variant="primary" size="sm" disabled>
            Put them side by side
          </Button>
        ) : (
          <Button asChild variant="primary" size="sm">
            <RouterLink to={to}>Put them side by side</RouterLink>
          </Button>
        )}

        {same ? (
          <FieldWarning>
            Pick two different executions — a comparison needs an earlier one and a later one.
          </FieldWarning>
        ) : null}
      </div>
    );
  },
);
