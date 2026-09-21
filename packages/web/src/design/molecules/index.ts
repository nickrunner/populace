/**
 * The molecule layer — ATOMIC-INVENTORY §2. All 34, in the inventory's own order.
 *
 * Two or three atoms with one job. Still product-agnostic except where a name is a product noun
 * — `PersonLink`, `SeverityTag`, `VerdictTag`, `CallRef`, `ToolName` — and even those know only
 * the *shape* of the fact, never where it came from. Molecule 28 is two components in one file
 * (`Money` and `Duration` in `Numeric.tsx`), which is why 34 molecules are 35 component exports.
 *
 * **What this barrel does not export.** The CVA factories — `navItem`, `segment`, `statGroup`,
 * `callRef` — stay behind their modules, exactly as `atoms/index.ts` keeps `textStyles` and
 * `button` behind theirs. A component's class string is not a public interface; `asChild` is the
 * sanctioned way for a `<Link>` to be a button or a chip (§0.2), and an exported class string is
 * the thing that stops being true. The `VariantProps` *types* are exported, because a type is a
 * description of the API rather than a second way to spell it.
 *
 * Two non-component exports earn their place. `parseTagList` is the single implementation of
 * `asList()` that the target editor and the persona editor each carried a verbatim copy of, and
 * `ThemeChoice` is the three-value union the pre-paint script in `index.html` agrees with.
 */

// 1 — Field
export { Field } from "./Field.js";
export type { FieldProps, FieldControlIds } from "./Field.js";

// 2 — FieldGrid
export { FieldGrid } from "./FieldGrid.js";
export type { FieldGridProps } from "./FieldGrid.js";

// 3 — FieldError
export { FieldError } from "./FieldError.js";
export type { FieldErrorProps } from "./FieldError.js";

// 4 — FieldWarning
export { FieldWarning } from "./FieldWarning.js";
export type { FieldWarningProps } from "./FieldWarning.js";

// 5 — SecretField
export { SecretField } from "./SecretField.js";
export type { SecretFieldProps } from "./SecretField.js";

// 6 — DurationField
export { DurationField } from "./DurationField.js";
export type { DurationFieldProps, DurationUnit } from "./DurationField.js";

// 7 — TagListField
export { TagListField, parseTagList } from "./TagListField.js";
export type { TagListFieldProps } from "./TagListField.js";

// 8 — ScaleField
export { ScaleField } from "./ScaleField.js";
export type { ScaleFieldProps } from "./ScaleField.js";

// 9 — Stepper
export { Stepper } from "./Stepper.js";
export type { StepperProps } from "./Stepper.js";

// 10 — SearchInput
export { SearchInput } from "./SearchInput.js";
export type { SearchInputProps } from "./SearchInput.js";

// 11 — FilterChip
export { FilterChip } from "./FilterChip.js";
export type { FilterChipProps } from "./FilterChip.js";

// 12 — FilterChips
export { FilterChips } from "./FilterChips.js";
export type { FilterChipsProps, FilterOption } from "./FilterChips.js";

// 13 — Stat
export { Stat } from "./Stat.js";
export type { StatProps } from "./Stat.js";

// 14 — StatGroup
export { StatGroup } from "./StatGroup.js";
export type { StatGroupProps, StatGroupVariants } from "./StatGroup.js";

// 15 — Breadcrumb
export { Breadcrumb } from "./Breadcrumb.js";
export type { BreadcrumbProps, Crumb } from "./Breadcrumb.js";

// 16 — NavItem
export { NavItem } from "./NavItem.js";
export type { NavItemProps, NavItemVariants } from "./NavItem.js";

// 17 — NavGroup
export { NavGroup } from "./NavGroup.js";
export type { NavGroupProps } from "./NavGroup.js";

// 18 — PersonLink
export { PersonLink } from "./PersonLink.js";
export type { PersonLinkProps, PersonNameVariants } from "./PersonLink.js";

// 19 — NameWithRole
export { NameWithRole } from "./NameWithRole.js";
export type { NameWithRoleProps } from "./NameWithRole.js";

// 20 — SeverityStack
export { SeverityStack } from "./SeverityStack.js";
export type { SeverityStackProps } from "./SeverityStack.js";

// 21 — SeverityTag
export { SeverityTag } from "./SeverityTag.js";
export type { SeverityTagProps } from "./SeverityTag.js";

// 22 — VerdictTag
export { VerdictTag } from "./VerdictTag.js";
export type { VerdictTagProps } from "./VerdictTag.js";

// 23 — CallRef
export { CallRef } from "./CallRef.js";
export type { CallRefProps } from "./CallRef.js";

// 24 — ToolName
export { ToolName } from "./ToolName.js";
export type { ToolNameProps } from "./ToolName.js";

// 25 — MetaLine
export { MetaLine } from "./MetaLine.js";
export type { MetaLineProps, MetaFact } from "./MetaLine.js";

// 26 — MetaSentence
export { MetaSentence } from "./MetaSentence.js";
export type { MetaSentenceProps } from "./MetaSentence.js";

// 27 — RelativeTime
export { RelativeTime } from "./RelativeTime.js";
export type { RelativeTimeProps, RelativeTimeMode } from "./RelativeTime.js";

// 28 — Money / Duration
export { Money, Duration } from "./Numeric.js";
export type { MoneyProps, DurationProps } from "./Numeric.js";

// 29 — CopyButton
export { CopyButton } from "./CopyButton.js";
export type { CopyButtonProps } from "./CopyButton.js";

// 30 — ThemeToggle
export { ThemeToggle } from "./ThemeToggle.js";
export type { ThemeToggleProps, ThemeChoice } from "./ThemeToggle.js";

// 31 — ConfirmButton
export { ConfirmButton } from "./ConfirmButton.js";
export type { ConfirmButtonProps } from "./ConfirmButton.js";

// 32 — StateBlock
export { StateBlock } from "./StateBlock.js";
export type { StateBlockProps } from "./StateBlock.js";

// 33 — Disclosure
export { Disclosure } from "./Disclosure.js";
export type { DisclosureProps } from "./Disclosure.js";

// 34 — Pagination
export { Pagination } from "./Pagination.js";
export type { PaginationProps } from "./Pagination.js";

/**
 * 35 — FactList. Added by the port review (S5.37): the label/value grid a record's steady column
 * is made of lived as a hand-written `grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]` on `Person`,
 * which §0.2 puts in `design/` rather than on a screen. `Fact` travels with it: it IS the list's
 * item, and a list whose items are declared somewhere else is two components pretending to be one.
 */
export { FactList, Fact } from "./FactList.js";
export type { FactListProps, FactProps } from "./FactList.js";

/**
 * 36/37/38 — the three field-group patterns the two editors of §6.3 rows 22 and 23 were carrying
 * by hand. `Repeater` is a field group you can have more than one of **and take one away again**,
 * which is the missing remove button §6.3 row 22 files as a real bug; `ConditionalFieldset` is
 * the one choice and the fields that belong to it, replacing row 23's "nested ternary returning
 * three JSX trees"; `KeyValueEditor` is a record whose keys the reader invents, which §5 page 11
 * names on the persona editor's traits. None of them knows a product noun.
 */
export { Repeater } from "./Repeater.js";
export type { RepeaterProps, RepeaterItem } from "./Repeater.js";

export { ConditionalFieldset } from "./ConditionalFieldset.js";
export type { ConditionalFieldsetProps, ConditionalBranch } from "./ConditionalFieldset.js";

export { KeyValueEditor } from "./KeyValueEditor.js";
export type { KeyValueEditorProps, KeyValueRow } from "./KeyValueEditor.js";
