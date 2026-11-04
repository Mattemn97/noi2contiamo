// MoneyField e PercentField: l'utente scrive in formato it-IT, il componente consegna interi
// (`Cents` o punti base). Lettura su stringa, senza virgola mobile: il NumberField di React Aria
// consegnerebbe un numero decimale, per questo qui c'è un TextField di React Aria con il parser di format.ts.
import type { BasisPoints, Cents, Result } from "@noi2contiamo/core";
import { useState } from "react";
import { FieldError, Group, Input, Label, Text, TextField as AriaTextField } from "react-aria-components";
import { t, type MessageKey } from "../../i18n/it";
import { formatScaledInput, parseEuroInput, parsePercentInput, type DecimalInputError } from "../format";
import { cx } from "../cx";
import styles from "../Field/Field.module.css";

const ERROR_KEYS: Readonly<Record<DecimalInputError, MessageKey>> = {
  empty: "field.error.empty",
  invalid: "field.error.invalid",
  precision: "field.error.precision",
};

interface ScaledFieldProps<T extends number> {
  readonly label: string;
  readonly value?: T | null;
  readonly onChange?: (value: T | null) => void;
  readonly description?: string | undefined;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
}

function ScaledField<T extends number>({
  label,
  value,
  onChange,
  description,
  isRequired = false,
  isDisabled = false,
  placeholder,
  name,
  parse,
  suffix,
}: ScaledFieldProps<T> & {
  readonly parse: (text: string) => Result<T, DecimalInputError>;
  readonly suffix: string;
}) {
  const [text, setText] = useState(() =>
    value === undefined || value === null ? "" : formatScaledInput(value),
  );
  const [touched, setTouched] = useState(false);
  const parsed = parse(text);
  const error: DecimalInputError | null = parsed.ok
    ? null
    : parsed.error === "empty" && !isRequired
      ? null
      : parsed.error;

  return (
    <AriaTextField
      className={cx(styles.field)}
      value={text}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={touched && error !== null}
      validationBehavior="aria"
      {...(name !== undefined ? { name } : {})}
      onChange={(next) => {
        setText(next);
        const result = parse(next);
        onChange?.(result.ok ? result.value : null);
      }}
      onBlur={() => {
        setTouched(true);
        if (parsed.ok) setText(formatScaledInput(parsed.value));
      }}
    >
      <Label className={cx(styles.label)}>{label}</Label>
      <Group className={cx(styles.control)}>
        <Input
          className={cx(styles.bare, styles.money)}
          inputMode="decimal"
          placeholder={placeholder ?? ""}
        />
        <span className={cx(styles.adornment)} aria-hidden="true">
          {suffix}
        </span>
      </Group>
      {description !== undefined ? (
        <Text slot="description" className={cx(styles.description)}>
          {description}
        </Text>
      ) : null}
      <FieldError className={cx(styles.error)}>{error !== null ? t(ERROR_KEYS[error]) : null}</FieldError>
    </AriaTextField>
  );
}

export type MoneyFieldProps = ScaledFieldProps<Cents>;

/** "12,5" → 1250, "1.234,56" → 123456. */
export function MoneyField(props: MoneyFieldProps) {
  return <ScaledField {...props} parse={parseEuroInput} suffix="€" />;
}

export type PercentFieldProps = ScaledFieldProps<BasisPoints>;

/** "12,5" → 1250 punti base (10000 = 100%). */
export function PercentField(props: PercentFieldProps) {
  return <ScaledField {...props} parse={parsePercentInput} suffix="%" />;
}
