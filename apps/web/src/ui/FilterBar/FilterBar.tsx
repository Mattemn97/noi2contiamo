// Filtri attivi come chip rimovibili (TagGroup di React Aria) più "Azzera filtri".
import { X } from "lucide-react";
import { Button as AriaButton, Label, Tag, TagGroup, TagList, type Key } from "react-aria-components";
import { t } from "../../i18n/it";
import { Button } from "../Button/Button";
import { cx } from "../cx";
import styles from "./FilterBar.module.css";

export interface Chip {
  readonly id: string;
  readonly label: string;
}

export interface FilterBarProps {
  readonly chips: readonly Chip[];
  readonly onRemove: (ids: ReadonlySet<Key>) => void;
  readonly onClear: () => void;
  readonly label?: string;
}

export function FilterBar({ chips, onRemove, onClear, label = t("common.activeFilters") }: FilterBarProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cx(styles.bar)}>
      <TagGroup className={cx(styles.group)} onRemove={onRemove}>
        <Label className="visually-hidden">{label}</Label>
        <TagList className={cx(styles.list)} items={chips}>
          {(chip) => (
            <Tag id={chip.id} textValue={chip.label} className={cx(styles.chip)}>
              {chip.label}
              <AriaButton slot="remove" className={cx(styles.remove)} aria-label={t("common.removeFilter")}>
                <X aria-hidden="true" strokeWidth={1.75} size={16} />
              </AriaButton>
            </Tag>
          )}
        </TagList>
      </TagGroup>
      <Button variant="ghost" size="sm" onPress={onClear}>
        {t("common.clearFilters")}
      </Button>
    </div>
  );
}
