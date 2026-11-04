// Select per liste brevi, ComboBox per liste lunghe con ricerca (categorie, destinatari).
import { ChevronDown } from "lucide-react";
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  FieldError,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
  type ComboBoxProps as AriaComboBoxProps,
  type Key,
  type SelectProps as AriaSelectProps,
} from "react-aria-components";
import { t } from "../../i18n/it";
import { cx } from "../cx";
import styles from "../Field/Field.module.css";

export interface Option {
  readonly id: string;
  readonly label: string;
}

interface ListFieldProps {
  readonly label: string;
  readonly options: readonly Option[];
  readonly description?: string | undefined;
  readonly errorMessage?: string | undefined;
}

function OptionList({ options }: { readonly options: readonly Option[] }) {
  return (
    <ListBox className={cx(styles.listbox)} items={options}>
      {(option) => (
        <ListBoxItem id={option.id} textValue={option.label} className={cx(styles.option)}>
          {option.label}
        </ListBoxItem>
      )}
    </ListBox>
  );
}

function Help({ description, errorMessage }: Pick<ListFieldProps, "description" | "errorMessage">) {
  return (
    <>
      {description !== undefined ? (
        <Text slot="description" className={cx(styles.description)}>
          {description}
        </Text>
      ) : null}
      <FieldError className={cx(styles.error)}>{errorMessage}</FieldError>
    </>
  );
}

export interface SelectProps
  extends ListFieldProps, Omit<AriaSelectProps<Option>, "className" | "style" | "children" | "items"> {
  readonly placeholder?: string;
}

export function Select({
  label,
  options,
  description,
  errorMessage,
  placeholder = t("common.selectPlaceholder"),
  ...props
}: SelectProps) {
  return (
    <AriaSelect {...props} placeholder={placeholder} className={cx(styles.field)}>
      <Label className={cx(styles.label)}>{label}</Label>
      <AriaButton className={cx(styles.control)}>
        <SelectValue className={cx(styles.value)} />
        <ChevronDown aria-hidden="true" strokeWidth={1.75} size={20} className={cx(styles.adornment)} />
      </AriaButton>
      <Help description={description} errorMessage={errorMessage} />
      <Popover className={cx(styles.popover)}>
        <OptionList options={options} />
      </Popover>
    </AriaSelect>
  );
}

export interface ComboBoxProps
  extends ListFieldProps, Omit<AriaComboBoxProps<Option>, "className" | "style" | "children" | "items"> {
  readonly placeholder?: string | undefined;
}

export function ComboBox({
  label,
  options,
  description,
  errorMessage,
  placeholder,
  ...props
}: ComboBoxProps) {
  return (
    <AriaComboBox {...props} className={cx(styles.field)} defaultItems={options}>
      <Label className={cx(styles.label)}>{label}</Label>
      <Group className={cx(styles.control)}>
        <Input className={cx(styles.bare)} placeholder={placeholder ?? ""} />
        <AriaButton className={cx(styles.trigger)}>
          <ChevronDown aria-hidden="true" strokeWidth={1.75} size={20} />
        </AriaButton>
      </Group>
      <Help description={description} errorMessage={errorMessage} />
      <Popover className={cx(styles.popover)}>
        <ListBox<Option> className={cx(styles.listbox)}>
          {(option) => (
            <ListBoxItem id={option.id} textValue={option.label} className={cx(styles.option)}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}

export type { Key };
