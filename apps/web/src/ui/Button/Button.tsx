// Bottone: comportamento da react-aria-components, stile da CSS Module e token.
import type { ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cx } from "../cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "style" | "children"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
}

export function Button({ variant = "primary", size = "md", icon, children, ...props }: ButtonProps) {
  return (
    <AriaButton {...props} className={cx(styles.button)} data-variant={variant} data-size={size}>
      {icon}
      {children}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon" | "aria-label"> {
  /** Etichetta obbligatoria dal catalogo `it.ts`: il bottone ha solo l'icona. */
  readonly label: string;
  readonly icon: ReactNode;
}

export function IconButton({ label, icon, variant = "ghost", size = "md", ...props }: IconButtonProps) {
  return (
    <AriaButton
      {...props}
      aria-label={label}
      className={cx(styles.button)}
      data-variant={variant}
      data-size={size}
      data-icon-only=""
    >
      {icon}
    </AriaButton>
  );
}
