// Scelte: Checkbox, Switch, RadioGroup, SegmentedControl (ToggleButtonGroup), Tabs.
import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import {
  CheckboxButton,
  CheckboxField,
  Label,
  RadioButton,
  RadioField,
  RadioGroup as AriaRadioGroup,
  SwitchButton,
  SwitchField,
  Tab,
  TabList,
  TabPanel,
  Tabs as AriaTabs,
  ToggleButton,
  ToggleButtonGroup,
  type CheckboxFieldProps,
  type Key,
  type RadioGroupProps as AriaRadioGroupProps,
  type SwitchFieldProps,
} from "react-aria-components";
import type { Option } from "../Select/Select";
import { cx } from "../cx";
import styles from "./Choice.module.css";

export interface CheckboxProps extends Omit<CheckboxFieldProps, "className" | "style" | "children"> {
  readonly children: ReactNode;
}

export function Checkbox({ children, ...props }: CheckboxProps) {
  return (
    <CheckboxField {...props}>
      <CheckboxButton className={cx(styles.check)}>
        {({ isIndeterminate, isSelected }) => (
          <>
            <span className={cx(styles.box)} aria-hidden="true">
              {isIndeterminate ? (
                <Minus strokeWidth={2.5} size={16} />
              ) : isSelected ? (
                <Check strokeWidth={2.5} size={16} />
              ) : null}
            </span>
            {children}
          </>
        )}
      </CheckboxButton>
    </CheckboxField>
  );
}

export interface SwitchProps extends Omit<SwitchFieldProps, "className" | "style" | "children"> {
  readonly children: ReactNode;
}

export function Switch({ children, ...props }: SwitchProps) {
  return (
    <SwitchField {...props}>
      <SwitchButton className={cx(styles.check)}>
        <span className={cx(styles.track)} aria-hidden="true">
          <span className={cx(styles.thumb)} />
        </span>
        {children}
      </SwitchButton>
    </SwitchField>
  );
}

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "className" | "style" | "children"> {
  readonly label: string;
  readonly options: readonly Option[];
}

export function RadioGroup({ label, options, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup {...props} className={cx(styles.group)}>
      <Label className={cx(styles.groupLabel)}>{label}</Label>
      {options.map((option) => (
        <RadioField key={option.id} value={option.id}>
          <RadioButton className={cx(styles.check)}>
            <span className={cx(styles.radio)} aria-hidden="true" />
            {option.label}
          </RadioButton>
        </RadioField>
      ))}
    </AriaRadioGroup>
  );
}

export interface SegmentedControlProps<T extends string> {
  /** Nome del gruppo per i lettori di schermo. */
  readonly label: string;
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className={cx(styles.segmented)}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = options.find((option) => keys.has(option.id));
        if (next) onChange(next.id);
      }}
    >
      {options.map((option) => (
        <ToggleButton key={option.id} id={option.id} className={cx(styles.segment)}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export interface TabsProps {
  readonly label: string;
  readonly items: readonly TabItem[];
  readonly selectedKey?: Key;
  readonly onSelectionChange?: (key: Key) => void;
}

export function Tabs({ label, items, ...props }: TabsProps) {
  return (
    <AriaTabs {...props} className={cx(styles.tabs)}>
      <TabList aria-label={label} className={cx(styles.tabList)}>
        {items.map((item) => (
          <Tab key={item.id} id={item.id} className={cx(styles.tab)}>
            {item.label}
          </Tab>
        ))}
      </TabList>
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={cx(styles.tabPanel)}>
          {item.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
