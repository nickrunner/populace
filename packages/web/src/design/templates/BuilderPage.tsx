import { forwardRef, type ReactNode } from "react";

import { Button } from "../atoms/index.js";
import type { StateKind } from "../tokens.js";
import { ActionBar } from "./ActionBar.js";
import { DocumentPage, type PageStateSlots } from "./DocumentPage.js";
import { FormBody } from "./FormBody.js";
import { SaveBar } from "./SaveBar.js";

/**
 * BuilderPage — ATOMIC-INVENTORY §4, template 9. One screen per noun: the persona, cohort,
 * population and study builders, each serving `new` and `:id` from the same file.
 *
 * `DocumentPage` + `FormBody` + **one of two bars, chosen by `mode`**. That last clause is the
 * whole reason the template exists. §6.3 row 16 records what happened when a page that creates
 * something was given `FormPage`: it opened saying *"Nothing changed yet"*, changed to *"Unsaved
 * changes"* as the reader typed, and offered *"Save changes"* about a record that did not exist —
 * every word about a thing that was already there. `ActionBar` was built to fix it, and the fix
 * was applied by hand: that screen composed `DocumentPage` + its own `<form>` + `ActionBar`. A
 * builder serving both `new` and `:id` would have had to do that in one branch and `FormPage` in
 * the other, and every builder would have done it slightly differently.
 *
 * So the switch is here, once:
 *
 *  - **`mode="create"`** is an `ActionBar`. The act is named in the product's own words
 *    (`actLabel` — "Make this persona", "Make this persona and go back"); the status line is the
 *    reason it cannot happen yet or a note about what happens next, never a dirtiness flag; and
 *    **the leave-the-tab guard is off**, because a builder persists its draft under the route and
 *    leaving loses nothing. Passing `guard={true}` here would be lying to the reader about a
 *    risk that does not exist.
 *  - **`mode="edit"`** is a `SaveBar`. Dirtiness is the right thing to report about a record that
 *    exists, "Discard changes" is a real escape, and the guard is `dirty`. The bar takes the same
 *    `blockedBecause`, `note` and `extra` the action bar does, so an edit refused for an emptied
 *    name says why in the same place a create does, and the study builder's "Apply to the running
 *    execution" sits beside the save rather than somewhere down the page.
 *
 * **Enter follows the bar.** `FormBody` makes Enter the act, and holds it while `blocked`; here
 * `blocked` is derived from the same facts the bar's button is — `blockedBecause` in create mode,
 * `blockedBecause` or nothing-to-save in edit mode — so the keyboard can never reach an act the
 * bar is refusing.
 *
 * **The props are a discriminated union, not one bag with two halves optional.** A create page
 * has no `savedAt` and an edit page has no `actLabel`; a flat shape would make both optional and
 * let a screen pass `savedAt` to a page that will never show it. Read `BuilderCreateProps` and
 * `BuilderEditProps` for exactly what each mode wants, and `BuilderPageCommon` for what both
 * share: the frame, the state slots, the bound and its reason, the note, the cancel and the
 * extra.
 *
 * Like every template it fetches nothing, names no product noun and hard-codes no screen's
 * content. Nothing here promises that what is made or saved changes what a future execution will
 * find (§7.3).
 */

/** What both modes share: the frame, the state slots, the bound and its reason, the ways out. */
export interface BuilderPageCommon extends PageStateSlots {
  /** A `PageHeader`. It owns the screen's single `<h1>`. */
  header: ReactNode;
  /** The instrument rail — a cost estimate, a deal preview. Beneath the content below 1240px. */
  rail?: ReactNode;
  /** When set, the matching slot renders INSTEAD of `children`, and no bar is drawn. */
  state?: StateKind;
  /**
   * Why the act cannot happen yet, in a sentence — "Give it a name first." The bar says it and
   * the button and Enter are held while it is set. `undefined` means nothing is stopping it.
   */
  blockedBecause?: ReactNode;
  /**
   * What the act will do, when that is worth a sentence and nothing blocks it — "Nothing is
   * spent until you send them in", "The next execution uses it." Never a promise about what an
   * execution will find (§7.3).
   */
  note?: ReactNode;
  /** The quiet way out, where the page has one. */
  onCancel?: () => void;
  /** Anything that belongs beside the act — "Apply to the running execution". */
  extra?: ReactNode;
  children: ReactNode;
}

/** `new`: the record does not exist yet. The foot is an `ActionBar`; the guard is off. */
export interface BuilderCreateProps extends BuilderPageCommon {
  mode: "create";
  /** The act, in the product's own words — "Make this cohort". Never "Save", never "Submit". */
  actLabel: string;
  /** The act is in flight. Its falling edge moves focus to the first invalid field. */
  pending: boolean;
  onAct: () => void;
}

/** `:id`: the record exists. The foot is a `SaveBar`; the guard is `dirty`. */
export interface BuilderEditProps extends BuilderPageCommon {
  mode: "edit";
  /** There are changes the reader has not saved. Drives the bar and the leave-the-tab guard. */
  dirty: boolean;
  /** A save is in flight. Its falling edge moves focus to the first invalid field. */
  saving: boolean;
  onSave: () => void;
  /** When the last successful save landed, ISO, or null if nothing has been saved yet. */
  savedAt: string | null;
  /** Offered only where there is something to throw away. */
  onDiscard?: () => void;
}

export type BuilderPageProps = BuilderCreateProps | BuilderEditProps;

export const BuilderPage = forwardRef<HTMLDivElement, BuilderPageProps>(function BuilderPage(
  props,
  ref,
) {
  const {
    header,
    rail,
    state,
    loading,
    error,
    empty,
    gone,
    blockedBecause,
    note,
    onCancel,
    extra,
    children,
  } = props;

  const held = blockedBecause !== undefined;

  // One `FormBody` for both modes, so the form's behaviour is the same and only the bar and the
  // facts feeding it differ. Written as two returns rather than a conditional bag of props
  // because each branch's props are the narrow half of the union, which is what makes the
  // `mode` check mean something to the compiler.
  const body =
    props.mode === "create" ? (
      <FormBody
        busy={props.pending}
        // The draft is persisted under the route; leaving the tab loses nothing.
        guard={false}
        blocked={held || props.pending}
        onSubmit={props.onAct}
        foot={
          <ActionBar
            label={props.actLabel}
            onAct={props.onAct}
            pending={props.pending}
            blockedBecause={blockedBecause}
            note={note}
            onCancel={onCancel}
            extra={extra}
          />
        }
      >
        {children}
      </FormBody>
    ) : (
      <FormBody
        busy={props.saving}
        guard={props.dirty}
        // Held while there is nothing to save, exactly as the bar's button is.
        blocked={held || !props.dirty || props.saving}
        onSubmit={props.onSave}
        foot={
          <SaveBar
            dirty={props.dirty}
            saving={props.saving}
            onSave={props.onSave}
            savedAt={props.savedAt}
            onDiscard={props.onDiscard}
            blockedBecause={blockedBecause}
            note={note}
            extra={
              extra === undefined && onCancel === undefined ? undefined : (
                <>
                  {extra}
                  {onCancel === undefined ? null : (
                    <CancelInBar onCancel={onCancel} disabled={props.saving} />
                  )}
                </>
              )
            }
          />
        }
      >
        {children}
      </FormBody>
    );

  return (
    <DocumentPage
      ref={ref}
      header={header}
      rail={rail}
      state={state}
      loading={loading}
      error={error}
      empty={empty}
      gone={gone}
    >
      {body}
    </DocumentPage>
  );
});

/**
 * `SaveBar` has no cancel of its own — an editor's way out is the navigation — but a builder in
 * edit mode reached through `?then=` has a place to go back to, and it goes in the same position
 * `ActionBar` gives its cancel: beside the act, quiet, the same `Button` at the same size. Kept
 * here rather than added to `SaveBar`, because the four editors that mount the bar directly have
 * no such place and a prop they never pass is a prop that will be passed wrongly.
 */
function CancelInBar({ onCancel, disabled }: { onCancel: () => void; disabled: boolean }): ReactNode {
  return (
    <Button variant="quiet" onClick={onCancel} disabled={disabled}>
      Cancel
    </Button>
  );
}
