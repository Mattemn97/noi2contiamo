// Campi di testo: etichetta visibile, aiuto e errore collegati da React Aria (aria-describedby).
import { Search, X } from "lucide-react";
import {
  Button as AriaButton,
  FieldError,
  Input,
  Label,
  SearchField as AriaSearchField,
  Text,
  TextField as AriaTextField,
  type SearchFieldProps as AriaSearchFieldProps,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { t } from "../../i18n/it";
import { cx } from "../cx";
import styles from "../Field/Field.module.css";

export interface TextFieldProps extends Omit<AriaTextFieldProps, "className" | "style" | "children"> {
  readonly label: string;
  readonly description?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly placeholder?: string | undefined;
}

export function TextField({ label, description, errorMessage, placeholder, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} className={cx(styles.field)}>
      <Label className={cx(styles.label)}>{label}</Label>
      <Input className={cx(styles.input)} placeholder={placeholder ?? ""} />
      {description !== undefined ? (
        <Text slot="description" className={cx(styles.description)}>
          {description}
        </Text>
      ) : null}
      <FieldError className={cx(styles.error)}>{errorMessage}</FieldError>
    </AriaTextField>
  );
}

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "className" | "style" | "children"> {
  readonly label?: string;
  readonly placeholder?: string | undefined;
}

export function SearchField({ label = t("common.search"), placeholder, ...props }: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={cx(styles.field)}>
      <Label className={cx(styles.label)}>{label}</Label>
      <div className={cx(styles.control)}>
        <Search aria-hidden="true" strokeWidth={1.75} size={20} className={cx(styles.adornment)} />
        <Input className={cx(styles.bare)} placeholder={placeholder ?? ""} />
        <AriaButton className={cx(styles.trigger)} aria-label={t("common.close")}>
          <X aria-hidden="true" strokeWidth={1.75} size={20} />
        </AriaButton>
      </div>
    </AriaSearchField>
  );
}
