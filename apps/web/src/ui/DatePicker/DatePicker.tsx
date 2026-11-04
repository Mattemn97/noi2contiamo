// Date in it-IT (settimana da lunedì grazie a I18nProvider in UiProvider). DateRangePicker ha le scorciatoie.
import {
  endOfMonth,
  getLocalTimeZone,
  startOfMonth,
  startOfYear,
  today,
  type CalendarDate,
} from "@internationalized/date";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker as AriaDatePicker,
  DateRangePicker as AriaDateRangePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Heading,
  Label,
  Popover,
  RangeCalendar,
  Text,
  type DatePickerProps as AriaDatePickerProps,
  type DateRange,
  type DateRangePickerProps as AriaDateRangePickerProps,
  type DateValue,
} from "react-aria-components";
import { t, type MessageKey } from "../../i18n/it";
import { cx } from "../cx";
import fieldStyles from "../Field/Field.module.css";
import styles from "./DatePicker.module.css";

interface DateFieldBaseProps {
  readonly label: string;
  readonly description?: string | undefined;
  readonly errorMessage?: string | undefined;
}

function CalendarHeader() {
  return (
    <header className={cx(styles.calendarHeader)}>
      <AriaButton slot="previous" className={cx(styles.navButton)}>
        <ChevronLeft aria-hidden="true" strokeWidth={1.75} size={20} />
      </AriaButton>
      <Heading className={cx(styles.heading)} />
      <AriaButton slot="next" className={cx(styles.navButton)}>
        <ChevronRight aria-hidden="true" strokeWidth={1.75} size={20} />
      </AriaButton>
    </header>
  );
}

function Help({ description, errorMessage }: Pick<DateFieldBaseProps, "description" | "errorMessage">) {
  return (
    <>
      {description !== undefined ? (
        <Text slot="description" className={cx(fieldStyles.description)}>
          {description}
        </Text>
      ) : null}
      <FieldError className={cx(fieldStyles.error)}>{errorMessage}</FieldError>
    </>
  );
}

function CalendarTrigger() {
  return (
    <AriaButton className={cx(fieldStyles.trigger)} aria-label={t("common.openCalendar")}>
      <CalendarDays aria-hidden="true" strokeWidth={1.75} size={20} />
    </AriaButton>
  );
}

export interface DatePickerProps
  extends DateFieldBaseProps, Omit<AriaDatePickerProps<CalendarDate>, "className" | "style" | "children"> {}

export function DatePicker({ label, description, errorMessage, ...props }: DatePickerProps) {
  return (
    <AriaDatePicker {...props} className={cx(fieldStyles.field)}>
      <Label className={cx(fieldStyles.label)}>{label}</Label>
      <Group className={cx(fieldStyles.control)}>
        <DateInput className={cx(fieldStyles.segments)}>
          {(segment) => <DateSegment segment={segment} className={cx(fieldStyles.segment)} />}
        </DateInput>
        <CalendarTrigger />
      </Group>
      <Help description={description} errorMessage={errorMessage} />
      <Popover className={cx(fieldStyles.popover)}>
        <Dialog className={cx(styles.dialog)}>
          <Calendar className={cx(styles.calendar)}>
            <CalendarHeader />
            <CalendarGrid className={cx(styles.grid)}>
              {(date) => <CalendarCell date={date} className={cx(styles.cell)} />}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}

export type PeriodShortcut = "thisMonth" | "lastMonth" | "last30" | "thisYear";

const SHORTCUTS: readonly (readonly [PeriodShortcut, MessageKey])[] = [
  ["thisMonth", "period.thisMonth"],
  ["lastMonth", "period.lastMonth"],
  ["last30", "period.last30"],
  ["thisYear", "period.thisYear"],
];

/** Intervallo di una scorciatoia rispetto a `now` (oggi nel fuso del dispositivo). */
export function shortcutRange(
  shortcut: PeriodShortcut,
  now: CalendarDate = today(getLocalTimeZone()),
): { readonly start: CalendarDate; readonly end: CalendarDate } {
  switch (shortcut) {
    case "thisMonth":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "lastMonth": {
      const previous = now.subtract({ months: 1 });
      return { start: startOfMonth(previous), end: endOfMonth(previous) };
    }
    case "last30":
      return { start: now.subtract({ days: 29 }), end: now };
    case "thisYear":
      return { start: startOfYear(now), end: now.set({ month: 12, day: 31 }) };
  }
}

export interface DateRangePickerProps
  extends
    DateFieldBaseProps,
    Omit<AriaDateRangePickerProps<DateValue>, "className" | "style" | "children" | "value" | "onChange"> {
  readonly value: DateRange | null;
  readonly onChange: (value: DateRange | null) => void;
}

export function DateRangePicker({
  label,
  description,
  errorMessage,
  value,
  onChange,
  ...props
}: DateRangePickerProps) {
  return (
    <AriaDateRangePicker {...props} value={value} onChange={onChange} className={cx(fieldStyles.field)}>
      <Label className={cx(fieldStyles.label)}>{label}</Label>
      <Group className={cx(fieldStyles.control)}>
        <DateInput slot="start" className={cx(styles.rangeInput)}>
          {(segment) => <DateSegment segment={segment} className={cx(fieldStyles.segment)} />}
        </DateInput>
        <span aria-hidden="true" className={cx(fieldStyles.adornment)}>
          –
        </span>
        <DateInput slot="end" className={cx(styles.rangeInput)}>
          {(segment) => <DateSegment segment={segment} className={cx(fieldStyles.segment)} />}
        </DateInput>
        <CalendarTrigger />
      </Group>
      <Help description={description} errorMessage={errorMessage} />
      <Popover className={cx(fieldStyles.popover)}>
        <Dialog className={cx(styles.dialog)}>
          <div role="group" aria-label={t("period.shortcuts")} className={cx(styles.shortcuts)}>
            {SHORTCUTS.map(([shortcut, key]) => (
              <AriaButton
                key={shortcut}
                className={cx(styles.shortcut)}
                onPress={() => {
                  onChange(shortcutRange(shortcut));
                }}
              >
                {t(key)}
              </AriaButton>
            ))}
          </div>
          <RangeCalendar className={cx(styles.calendar)}>
            <CalendarHeader />
            <CalendarGrid className={cx(styles.grid)}>
              {(date) => <CalendarCell date={date} className={cx(styles.cell)} />}
            </CalendarGrid>
          </RangeCalendar>
        </Dialog>
      </Popover>
    </AriaDateRangePicker>
  );
}
