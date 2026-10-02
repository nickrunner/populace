import { forwardRef, useCallback, useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

/**
 * FormBody — the `<form>` an editor or a builder is made of, with the two behaviours every one
 * of them owes and none of them should re-roll: a keyboard route to the act, and focus moved to
 * the first field that rejected it. It knows nothing about saving versus creating; that is what
 * the `foot` it is handed says.
 *
 * It exists because `FormPane` had grown two jobs. `FormPane` was the form, the unsaved-changes
 * guard and a `SaveBar`, in one piece — right for the four editors it was built for, and wrong
 * for a page that CREATES something, where the foot is an `ActionBar` and a guard is the wrong
 * shape (the draft is persisted, so leaving the tab loses nothing). The builders needed the form
 * without the bar, and copying the form's two behaviours into a second template is exactly the
 * defect §6.3 row 23 lifted the guard out of a screen to avoid. So the form is its own piece now,
 * and `FormPane` and `BuilderPage` both compose it.
 *
 * **1. Submitting is the act.** Enter in a text field submits, so the act has a keyboard route
 * that does not depend on reaching the bar. **While `blocked`, Enter is a no-op**: the bar is
 * already saying why the act cannot happen yet, and a submit that fired anyway would either run
 * an act the page has said it is refusing or force every screen to re-check its own bar's
 * condition inside `onSubmit`. One place knows the bound, and the form asks it.
 *
 * **2. Field-error focus management.** On the falling edge of `busy` — the save or the act has
 * just finished — if anything in the form is `aria-invalid`, focus moves to the first such
 * control and it is scrolled into view. `Field` and `FieldError` wire the message itself as
 * `role="alert"` through `aria-describedby`, so moving focus to the control reads the control's
 * own label, its value and the message that rejected it, in that order, without this component
 * knowing what any of them say.
 *
 * **3. The leave-the-tab guard, only when asked.** While `guard`, leaving the tab asks first.
 * The caller decides what `guard` means: an editor passes its `dirty` flag, a builder in create
 * mode passes `false` because its draft is already persisted and there is nothing to lose.
 * **In-app navigation is not blocked**, and that is a limitation worth stating rather than
 * hiding: React Router's `useBlocker` needs a data router, the app mounts a `<BrowserRouter>`,
 * and a template is the wrong place to change how the app routes.
 *
 * **The `foot` is a sibling of the `<form>`, not a child of a wrapper**, because a `sticky`
 * element can only travel inside its own parent's box — a bar wrapped in a div of its own height
 * has nowhere to stick and would quietly sit at the end of the page instead. That is also why
 * the bar is a prop rather than a child: the form has to know where the bar goes, and the bar
 * has to be outside the form so a button inside it that is not the act (a cancel, an "Apply to
 * the running execution") is never a `<button>` inside a `<form>` with an implicit submit type.
 *
 * Nothing here promises that what is submitted changes what a future execution will find (§7.3);
 * it submits a form.
 */
export interface FormBodyProps {
  /**
   * The save or the act is in flight. Its falling edge is what moves focus to the first invalid
   * field.
   */
  busy: boolean;
  /**
   * Leaving the tab should ask first. An editor passes `dirty`; a builder whose draft is
   * persisted passes `false`.
   */
  guard: boolean;
  /**
   * The act cannot happen yet — the bar is saying why. Enter does nothing while this is set, so
   * the keyboard cannot reach an act the page has refused.
   */
  blocked?: boolean;
  /** What the form commits to. Called on Enter and by nothing else here; the bar has its own. */
  onSubmit: () => void;
  /** The sticky bar: a `SaveBar` or an `ActionBar`. Rendered as the form's sibling. */
  foot: ReactNode;
  children: ReactNode;
}

export const FormBody = forwardRef<HTMLFormElement, FormBodyProps>(function FormBody(
  { busy, guard, blocked = false, onSubmit, foot, children },
  ref,
) {
  const formRef = useRef<HTMLFormElement>(null);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (!guard) return undefined;

    function warn(event: BeforeUnloadEvent): void {
      // The browser supplies the wording; a custom string has been ignored for a decade.
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [guard]);

  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finished) return;

    const form = formRef.current;
    if (form === null) return;

    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid === null) return;

    invalid.focus();
    // `block: "center"` rather than the default, so the field lands clear of both the header
    // above it and the bar pinned below it.
    invalid.scrollIntoView({ block: "center" });
  }, [busy]);

  const submit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      // Always prevented: a native submit would navigate. Then the bound — a blocked form
      // swallows Enter exactly as a held button swallows a click, and for the same reason.
      event.preventDefault();
      if (blocked) return;
      onSubmit();
    },
    [blocked, onSubmit],
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

      {foot}
    </>
  );
});
