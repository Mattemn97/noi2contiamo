// Sistema · Chiaro · Scuro. Cambia subito il tema e ricorda la scelta sul dispositivo.
import { t } from "../../i18n/it";
import { SegmentedControl } from "../Choice/Choice";
import { useThemePreference, type ThemePreference } from "../theme";

const OPTIONS: readonly { readonly id: ThemePreference; readonly label: string }[] = [
  { id: "system", label: t("theme.system") },
  { id: "light", label: t("theme.light") },
  { id: "dark", label: t("theme.dark") },
];

export function ThemeSwitcher() {
  const [preference, setPreference] = useThemePreference();
  return (
    <SegmentedControl
      label={t("theme.label")}
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
    />
  );
}
