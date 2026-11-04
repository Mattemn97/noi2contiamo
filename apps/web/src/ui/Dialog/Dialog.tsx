// Dialog (finestra centrata; foglio dal basso sotto 48rem), Sheet (sempre dal basso), ConfirmDialog.
// Esc chiude, il focus resta dentro e torna al bottone che ha aperto.
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from "react-aria-components";
import { t } from "../../i18n/it";
import { Button, IconButton } from "../Button/Button";
import { cx } from "../cx";
import styles from "./Dialog.module.css";

export interface DialogProps extends Pick<ModalOverlayProps, "isOpen" | "onOpenChange" | "isDismissable"> {
  readonly title: string;
  readonly children: ReactNode;
  /** Bottone che apre il dialogo; senza, il dialogo è controllato da `isOpen`. */
  readonly trigger?: ReactElement;
  readonly footer?: (close: () => void) => ReactNode;
  readonly variant?: "dialog" | "sheet";
  readonly role?: "dialog" | "alertdialog";
}

export function Dialog({
  title,
  children,
  trigger,
  footer,
  variant = "dialog",
  role = "dialog",
  isDismissable = true,
  ...overlayProps
}: DialogProps) {
  const modal = (
    <ModalOverlay {...overlayProps} isDismissable={isDismissable} className={cx(styles.overlay)}>
      <Modal className={cx(styles.modal)} data-variant={variant}>
        <AriaDialog className={cx(styles.dialog)} role={role}>
          {({ close }) => (
            <>
              <div className={cx(styles.header)}>
                <Heading slot="title" className={cx(styles.title)}>
                  {title}
                </Heading>
                <IconButton
                  label={t("common.close")}
                  icon={<X aria-hidden="true" strokeWidth={1.75} />}
                  onPress={close}
                />
              </div>
              <div className={cx(styles.body)}>{children}</div>
              {footer ? <div className={cx(styles.footer)}>{footer(close)}</div> : null}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
  return trigger ? (
    <DialogTrigger>
      {trigger}
      {modal}
    </DialogTrigger>
  ) : (
    modal
  );
}

export function Sheet(props: Omit<DialogProps, "variant">) {
  return <Dialog {...props} variant="sheet" />;
}

export interface ConfirmDialogProps extends Omit<DialogProps, "footer" | "role" | "children"> {
  readonly message: string;
  readonly confirmLabel?: string;
  readonly onConfirm: () => void;
}

/** Conferma per azioni distruttive: "Annulla" a sinistra, l'azione in rosso a destra. */
export function ConfirmDialog({
  message,
  confirmLabel = t("common.delete"),
  onConfirm,
  ...props
}: ConfirmDialogProps) {
  return (
    <Dialog
      {...props}
      role="alertdialog"
      isDismissable={false}
      footer={(close) => (
        <>
          <Button variant="secondary" onPress={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              onConfirm();
              close();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <p>{message}</p>
    </Dialog>
  );
}
