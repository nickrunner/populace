/**
 * The atom layer — ATOMIC-INVENTORY §1. All 33, in the inventory's own order.
 *
 * The irreducible ones: nothing here knows about a finding, a cohort or an execution. Atom 14 is
 * two components in one file (`Radio` and `RadioGroup`), which is why 33 atoms are 34 exports.
 *
 * **What this barrel does not export.** The CVA factories — `textStyles`, `button` — stay behind
 * their modules. A component's class string is not a public interface; `asChild` is the sanctioned
 * way for a `<Link>` to be a button or a chip (§0.2), and an exported class string is the thing
 * that stops being true. Anything inside `design/` that genuinely needs a fragment imports it from
 * the module that owns it, the way `Heading`, `Mono` and `Code` already take `textStyles` from
 * `./Text.js`.
 */

// 1 — Text
export { Text } from "./Text.js";
export type {
  TextProps,
  TextSize,
  TextTone,
  TextElement,
  TextStyleVariants,
  SerifTextSize,
  SansTextSize,
  TypeStep,
} from "./Text.js";

// 2 — Heading
export { Heading } from "./Heading.js";
export type { HeadingProps, HeadingSize } from "./Heading.js";

// 3 — Mono
export { Mono } from "./Mono.js";
export type { MonoProps, MonoSize } from "./Mono.js";

// 4 — Code
export { Code } from "./Code.js";
export type { CodeProps } from "./Code.js";

// 5 — Kbd
export { Kbd } from "./Kbd.js";
export type { KbdProps } from "./Kbd.js";

// 6 — Button
export { Button } from "./Button.js";
export type { ButtonProps, ButtonVariant, ButtonStyleVariants } from "./Button.js";

// 7 — IconButton
export { IconButton } from "./IconButton.js";
export type { IconButtonProps } from "./IconButton.js";

// 8 — Link
export { Link } from "./Link.js";
export type { LinkProps, LinkStyleVariants } from "./Link.js";

// 9 — Input
export { Input } from "./Input.js";
export type { InputProps } from "./Input.js";

// 10 — NumberInput
export { NumberInput } from "./NumberInput.js";
export type { NumberInputProps } from "./NumberInput.js";

// 11 — TextArea
export { TextArea } from "./TextArea.js";
export type { TextAreaProps } from "./TextArea.js";

// 12 — Select
export { Select } from "./Select.js";
export type { SelectProps, SelectOption } from "./Select.js";

// 13 — Checkbox
export { Checkbox } from "./Checkbox.js";
export type { CheckboxProps } from "./Checkbox.js";

// 14 — Radio / RadioGroup
export { Radio, RadioGroup } from "./Radio.js";
export type { RadioProps, RadioGroupProps } from "./Radio.js";

// 15 — Switch
export { Switch } from "./Switch.js";
export type { SwitchProps } from "./Switch.js";

// 16 — Slider
export { Slider } from "./Slider.js";
export type { SliderProps } from "./Slider.js";

// 17 — Label
export { Label } from "./Label.js";
export type { LabelProps } from "./Label.js";

// 18 — Badge
export { Badge } from "./Badge.js";
export type { BadgeProps, BadgeVariant, BadgeTone, BadgeVariants } from "./Badge.js";

// 19 — Chip
export { Chip } from "./Chip.js";
export type { ChipProps, ChipVariants } from "./Chip.js";

// 20 — Avatar
export { Avatar } from "./Avatar.js";
export type { AvatarProps, AvatarVariants } from "./Avatar.js";

// 21 — Icon
export { Icon } from "./Icon.js";
export type { IconProps, IconName, IconVariants } from "./Icon.js";

// 22 — Separator
export { Separator } from "./Separator.js";
export type { SeparatorProps } from "./Separator.js";

// 23 — Spacer
export { Spacer } from "./Spacer.js";
export type { SpacerProps } from "./Spacer.js";

// 24 — Stack
export { Stack } from "./Stack.js";
export type { StackProps } from "./Stack.js";

// 25 — Inline
export { Inline } from "./Inline.js";
export type { InlineProps } from "./Inline.js";

// 26 — Measure
export { Measure } from "./Measure.js";
export type { MeasureProps, MeasureWidth, MeasureElement } from "./Measure.js";

// 27 — Meter
export { Meter } from "./Meter.js";
export type { MeterProps, MeterVariants } from "./Meter.js";

// 28 — Spinner
export { Spinner } from "./Spinner.js";
export type { SpinnerProps } from "./Spinner.js";

// 29 — Skeleton
export { Skeleton } from "./Skeleton.js";
export type { SkeletonProps } from "./Skeleton.js";

// 30 — Tooltip
export { Tooltip } from "./Tooltip.js";
export type { TooltipProps } from "./Tooltip.js";

// 31 — VisuallyHidden
export { VisuallyHidden } from "./VisuallyHidden.js";
export type { VisuallyHiddenProps } from "./VisuallyHidden.js";

// 32 — SkipLink
export { SkipLink } from "./SkipLink.js";
export type { SkipLinkProps } from "./SkipLink.js";

// 33 — ScrollArea
export { ScrollArea } from "./ScrollArea.js";
export type { ScrollAreaProps } from "./ScrollArea.js";
