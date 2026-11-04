// Colore principale dell'app: sei colori con contrasto già verificato nei due temi.
import { Check } from "lucide-react";
import { useId } from "react";
import { t, type MessageKey } from "../../i18n/it";
import { cx } from "../cx";
import { ACCENT_PREFERENCES, useAccentPreference, type AccentPreference } from "../theme";
import styles from "./AccentPicker.module.css";

const LABELS: Readonly<Record<AccentPreference, MessageKey>> = {
  green: "theme.accent.green",
  blue: "theme.accent.blue",
  violet: "theme.accent.violet",
  pink: "theme.accent.pink",
  orange: "theme.accent.orange",
  graphite: "theme.accent.graphite",
};

export function AccentPicker() {
  const [preference, setPreference] = useAccentPreference();
  const name = useId();
  return (
    <fieldset className={cx(styles.group)}>
      <legend className={cx(styles.legend)}>{t("theme.accent")}</legend>
      <div className={cx(styles.options)}>
        {ACCENT_PREFERENCES.map((accent) => (
          <label key={accent} className={cx(styles.option)} title={t(LABELS[accent])}>
            <input
              className={cx(styles.input)}
              type="radio"
              name={name}
              aria-label={t(LABELS[accent])}
              checked={accent === preference}
              onChange={() => {
                setPreference(accent);
              }}
            />
            <span className={cx(styles.swatch)} data-swatch={accent}>
              {accent === preference ? <Check aria-hidden="true" size={16} strokeWidth={3} /> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
