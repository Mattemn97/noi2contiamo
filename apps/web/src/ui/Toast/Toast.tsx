// Toast nostro: regione aria-live="polite" sempre presente, ogni messaggio sparisce dopo 5 secondi,
// azione "Annulla" opzionale. UiProvider monta il provider e la regione.
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "../../i18n/it";
import { Button, IconButton } from "../Button/Button";
import { cx } from "../cx";
import styles from "./Toast.module.css";

export const TOAST_DURATION_MS = 5000;

export interface ToastInput {
  readonly message: string;
  /** Azione opzionale, di solito "Annulla". */
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

interface ToastItem extends ToastInput {
  readonly id: number;
}

interface ToastApi {
  readonly show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast va usato dentro <UiProvider>");
  return api;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className={cx(styles.region)} aria-label={t("toast.region")} aria-live="polite">
        {toasts.map((toast) => (
          <ToastMessage key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastMessage({
  toast,
  onDismiss,
}: {
  readonly toast: ToastItem;
  readonly onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, onDismiss]);

  return (
    <div className={cx(styles.toast)}>
      <p className={cx(styles.message)}>{toast.message}</p>
      {toast.action ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton
        size="sm"
        label={t("common.close")}
        icon={<X aria-hidden="true" strokeWidth={1.75} />}
        onPress={() => {
          onDismiss(toast.id);
        }}
      />
    </div>
  );
}
