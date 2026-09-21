import { forwardRef } from "react";

import { DocumentPage, type DocumentPageProps } from "./DocumentPage.js";
import { FormPane } from "./FormPane.js";

/**
 * FormPage — ATOMIC-INVENTORY §4, template 5. Four screens.
 *
 * `DocumentPage` plus the three things an editor needs and a reading page does not: a sticky
 * `SaveBar`, an unsaved-changes guard and field-error focus management. All three are `FormPane`,
 * and they are there rather than here because `PersonaEditor` is **`SplitPage` + `FormPage`** (§5
 * page 11) and two page templates cannot nest — what that screen needs is the form, the bar and
 * the guard, not a second frame. This template adds no layout of its own: a form is a document you
 * can change, so it is the same reading column, the same stub grid, the same optional rail.
 */
export interface FormPageProps extends DocumentPageProps {
  /** There are changes the reader has not saved. Drives the bar and the leave-the-tab guard. */
  dirty: boolean;
  /** A save is in flight. Its falling edge is what moves focus to the first invalid field. */
  saving: boolean;
  onSave: () => void;
  /** When the last successful save landed, ISO, or null if nothing has been saved yet. */
  savedAt: string | null;
}

export const FormPage = forwardRef<HTMLDivElement, FormPageProps>(function FormPage(
  { header, rail, state, loading, error, empty, gone, children, dirty, saving, onSave, savedAt },
  ref,
) {
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
      <FormPane dirty={dirty} saving={saving} onSave={onSave} savedAt={savedAt}>
        {children}
      </FormPane>
    </DocumentPage>
  );
});
