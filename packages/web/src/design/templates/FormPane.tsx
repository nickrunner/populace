import { forwardRef, type ReactNode } from "react";

import { FormBody } from "./FormBody.js";
import { SaveBar } from "./SaveBar.js";

/**
 * FormPane — the three things an editor needs, in one place, independent of the page shape.
 *
 * `FormPage` is `DocumentPage` + this. It was the whole of `FormPage`'s body until the persona
 * editor arrived: ATOMIC-INVENTORY §5 page 11 gave that screen **`SplitPage` + `FormPage`**, and
 * the two cannot nest — a page template owns the frame, and there is only one frame. What the
 * screen actually needs from `FormPage` is not the column; it is the form, the bar and the guard.
 * So they live here, and both page shapes compose the same implementation rather than a second
 * copy of it.
 *
 * That is also what §6.3 row 23 asks for in so many words: the persona editor held the app's only
 * `dirty` flag, *"and that flag becomes the unsaved-changes guard for every `FormPage`, so lift it
 * into the template rather than leaving it local"*. A guard re-rolled inside a screen is the same
 * defect as a class string re-rolled inside a screen.
 *
 * **It is `FormBody` + `SaveBar`, and nothing of its own.** The form, the Enter route, the
 * falling-edge focus move and the leave-the-tab guard are `FormBody`'s; this component only says
 * what they mean for an editor — the guard is `dirty`, busy is `saving`, Enter is held while
 * there is nothing to save, and the foot is the sticky `SaveBar`. `BuilderPage` makes the same
 * choices for a page that can also create, and the split is what lets the two agree by
 * construction rather than by review.
 *
 * Nothing here promises that saving changes what a future execution will find (§7.3); it saves a
 * form.
 */
export interface FormPaneProps {
  /** There are changes the reader has not saved. Drives the bar and the leave-the-tab guard. */
  dirty: boolean;
  /** A save is in flight. Its falling edge is what moves focus to the first invalid field. */
  saving: boolean;
  onSave: () => void;
  /** When the last successful save landed, ISO, or null if nothing has been saved yet. */
  savedAt: string | null;
  /** Offered only where there is something to throw away; passed straight to the bar. */
  onDiscard?: () => void;
  children: ReactNode;
}

export const FormPane = forwardRef<HTMLFormElement, FormPaneProps>(function FormPane(
  { dirty, saving, onSave, savedAt, onDiscard, children },
  ref,
) {
  return (
    <FormBody
      ref={ref}
      busy={saving}
      guard={dirty}
      // The bar's button is held while nothing has changed; Enter is held for the same reason,
      // or a reader could save an unchanged record from the keyboard and not from the bar.
      blocked={!dirty || saving}
      onSubmit={onSave}
      foot={
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={onSave}
          savedAt={savedAt}
          onDiscard={onDiscard}
        />
      }
    >
      {children}
    </FormBody>
  );
});
