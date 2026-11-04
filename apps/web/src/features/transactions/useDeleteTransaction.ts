// Cancellare un movimento: niente archivio, il movimento sparisce (con conferma prima, nella UI).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { useToast } from "../../ui";

export function useDeleteTransaction(familyId: string, onDeleted?: () => void) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await adapter.remove(familyId, "transactions", id));
    },
    onSuccess: async (_, id) => {
      // Prima si esce dalla pagina del movimento, poi si aggiornano le liste (niente "non trovato" di passaggio).
      onDeleted?.();
      client.removeQueries({ queryKey: [...keys.collection(familyId, "transactions"), "doc", id] });
      toast.show({ message: t("tx.deleted") });
      await client.invalidateQueries({ queryKey: keys.collection(familyId, "transactions") });
    },
  });
}
