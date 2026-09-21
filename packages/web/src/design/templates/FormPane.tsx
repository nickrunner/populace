import { forwardRef, useCallback, useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

import { SaveBar } from "./SaveBar.js";

/**
 * FormPane — the three things an editor needs, in one place, independent of the page shape.
 *
 * `FormPage` is `DocumentPage` + this. It was the whole of `FormPage`'s body until `PersonaEditor`
 * arrived: ATOMIC-INVENTORY §5 page 11 gives that screen **`SplitPage` + `FormPage`**, and the two
 * cannot nest — a page template owns the frame, and there is only one frame. What the screen
 * actually needs from `FormPage` is not the column; it is the form, the bar and the guard. So they
 * live here, and both page shapes compose the same implementation rather than a second copy of it.
 *
 * That is also what §6.3 row 23 asks for in so many words: `PersonaEditor` holds the app's only
 * `dirty` flag, *"and that flag becomes the unsaved-changes guard for every `FormPage`, so lift it
 * into the template rather than leaving it local"*. A guard re-rolled inside a screen is the same
 * defect as a class string re-rolled inside a screen.
 *
 * **1. A sticky `SaveBar` at the foot of the column.** It is a sibling of the `<form>` rather than
 * a child of a wrapper, because a `sticky` element can only travel inside its own parent's box — a
 * bar wrapped in a div of its own height has nowhere to stick and would quietly sit at the end of
 * the page instead.
 *
 * **2. An unsaved-changes guard.** While `dirty`, leaving the tab asks first. **In-app navigation
 * is not blocked**, and that is a limitation worth stating rather than hiding: React Router's
 * `useBlocker` needs a data router, the app mounts a `<BrowserRouter>`, and a template is the
 * wrong place to change how the app routes.
 *
 * **3. Field-error focus management.** When a save finishes and something in the form is
 * `aria-invalid`, focus moves to the first such control and it is scrolled into view. `Field` and
 * `FieldError` wire the message itself as `role="alert"` through `aria-describedby`, so moving
 * focus to the control reads the control's own label, its value and the message that rejected it,
 * in that order, without the template knowing what any of them say.
 *
 * Submitting the form — Enter in a text field — is a save, so the act has a keyboard route that
 * does not depend on reaching the bar. Nothing here promises that saving changes what a future
 * execution will find (§7.3); it saves a form.
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
  const formRef = useRef<HTMLFormElement>(null);
  const wasSaving = useRef(false);

  useEffect(() => {
    if (!dirty) return undefined;

    function warn(event: BeforeUnloadEvent): void {
      // The browser supplies the wording; a custom string has been ignored for a decade.
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  useEffect(() => {
    const finished = wasSaving.current && !saving;
    wasSaving.current = saving;
    if (!finished) return;

    const form = formRef.current;
    if (form === null) return;

    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid === null) return;

    invalid.focus();
    // `block: "center"` rather than the default, so the field lands clear of both the header
    // above it and the bar pinned below it.
    invalid.scrollIntoView({ block: "center" });
  }, [saving]);

  const submit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSave();
    },
    [onSave],
  );

  return (
    <>
      {/*
        `noValidate`: every message a reader sees is the product's own, in the product's own
        voice, wired to the field that earned it — never a browser bubble that vanishes on the
        next keystroke and reaches no screen reader (§6, §7.4).
      */}
      <form
        ref={(node) => {
          formRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref !== null) ref.current = node;
        }}
        onSubmit={submit}
        noValidate
        className="pb-8"
      >
        {children}
      </form>

      <SaveBar dirty={dirty} saving={saving} onSave={onSave} savedAt={savedAt} onDiscard={onDiscard} />
    </>
  );
});
