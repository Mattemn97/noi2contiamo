// Pezzi comuni alle pagine di conti, categorie e destinatari: salvataggio, archivio, messaggi d'errore.
import type { CollectionName, WriteDocOf } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdapter } from "../../data/AdapterContext";
import { DataQueryError, keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, useToast } from "../../ui";

export function saveErrorText(error: unknown): string {
  if (
    error instanceof DataQueryError &&
    error.error.code === "conflict" &&
    error.error.reason === "duplicate"
  )
    return t("catalog.error.duplicate");
  return t("catalog.error.other");
}

/** Salva un documento della collezione e aggiorna le liste; `onSaved` chiude il modulo. */
export function useSave<C extends CollectionName>(familyId: string, collection: C, onSaved?: () => void) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (doc: WriteDocOf<C>) => unwrap(await adapter.put(familyId, collection, doc)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.collection(familyId, collection) });
      toast.show({ message: t("catalog.saved") });
      onSaved?.();
    },
  });
}

/** Archivia o ripristina: la voce resta nello storico, fuori dalle scelte nuove. */
export function ArchiveButton<C extends "accounts" | "categories" | "payees">({
  familyId,
  collection,
  doc,
}: {
  readonly familyId: string;
  readonly collection: C;
  readonly doc: WriteDocOf<C> & { readonly archivedAtMs: number | null };
}) {
  const save = useSave(familyId, collection);
  const archived = doc.archivedAtMs !== null;
  return (
    <Button
      size="sm"
      variant="ghost"
      isPending={save.isPending}
      onPress={() => {
        save.mutate({ ...doc, archivedAtMs: archived ? null : Date.now() });
      }}
    >
      {t(archived ? "catalog.restore" : "catalog.archive")}
    </Button>
  );
}
