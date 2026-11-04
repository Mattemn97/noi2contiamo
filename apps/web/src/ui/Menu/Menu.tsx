// Menu di azioni (riga di tabella), Tooltip (solo spiegazioni), Link.
import type { ReactElement, ReactNode } from "react";
import {
  Link as AriaLink,
  Menu as AriaMenu,
  MenuItem,
  MenuTrigger,
  OverlayArrow,
  Popover,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type Key,
  type LinkProps as AriaLinkProps,
} from "react-aria-components";
import { cx } from "../cx";
import fieldStyles from "../Field/Field.module.css";
import styles from "./Menu.module.css";

export interface MenuAction {
  readonly id: string;
  readonly label: string;
  readonly tone?: "danger";
}

export interface MenuProps {
  /** Bottone che apre il menu (di solito un IconButton con etichetta). */
  readonly trigger: ReactElement;
  readonly actions: readonly MenuAction[];
  readonly onAction: (id: Key) => void;
}

export function Menu({ trigger, actions, onAction }: MenuProps) {
  return (
    <MenuTrigger>
      {trigger}
      <Popover className={cx(fieldStyles.popover)} placement="bottom end">
        <AriaMenu className={cx(fieldStyles.listbox)} items={actions} onAction={onAction}>
          {(action) => (
            <MenuItem id={action.id} className={cx(fieldStyles.option)} data-tone={action.tone}>
              {action.label}
            </MenuItem>
          )}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export interface TooltipProps {
  readonly text: string;
  /** Elemento focalizzabile che mostra il tooltip (un bottone). */
  readonly children: ReactElement;
}

export function Tooltip({ text, children }: TooltipProps) {
  return (
    <TooltipTrigger delay={300}>
      {children}
      <AriaTooltip className={cx(styles.tooltip)} offset={8}>
        <OverlayArrow className={cx(styles.arrow)}>
          <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {text}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

export interface LinkProps extends Omit<AriaLinkProps, "className" | "style" | "children"> {
  readonly children: ReactNode;
}

export function Link({ children, ...props }: LinkProps) {
  return (
    <AriaLink {...props} className={cx(styles.link)}>
      {children}
    </AriaLink>
  );
}
