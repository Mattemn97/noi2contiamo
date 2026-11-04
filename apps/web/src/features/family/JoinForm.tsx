// Entrare in una famiglia con un invito: codice (o link) e nome; errori di invito come messaggi chiari.
import type { InviteError } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import { Button, TextField, useToast } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { parseInviteCode, storeActiveFamily } from "./invite";

type JoinFailure = "code" | "name" | InviteError["code"] | "already_member";

export function joinErrorKey(failure: JoinFailure): MessageKey {
  switch (failure) {
    case "code":
    case "name":
    case "expired":
    case "used":
    case "revoked":
    case "not_found":
    case "already_member":
      return `join.error.${failure}`;
    default:
      return "join.error.other";
  }
}

export interface JoinFormProps {
  /** Il codice arrivato dal link: il campo del codice non si mostra. */
  readonly code?: string;
}

export function JoinForm({ code: fromLink }: JoinFormProps) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState(fromLink ?? "");
  const [displayName, setDisplayName] = useState("");
  const [failure, setFailure] = useState<JoinFailure | null>(null);

  const join = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const token = parseInviteCode(code);
      if (!token) {
        setFailure("code");
        return null;
      }
      if (displayName.trim() === "") {
        setFailure("name");
        return null;
      }
      const result = await adapter.membership.acceptInvite(token, displayName.trim());
      if (!result.ok) {
        const error = result.error;
        setFailure(
          error.code === "conflict" && error.reason === "already_member" ? "already_member" : error.code,
        );
        return null;
      }
      setFailure(null);
      return result.value;
    },
    onSuccess: async (familyId) => {
      if (!familyId) return;
      storeActiveFamily(familyId);
      await client.invalidateQueries({ queryKey: keys.families });
      toast.show({ message: t("join.done") });
      await navigate("/", { replace: true });
    },
  });

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    join.mutate();
  };

  return (
    <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
      {fromLink === undefined ? (
        <TextField
          label={t("join.code")}
          description={t("join.codeHelp")}
          autoComplete="off"
          isRequired
          value={code}
          onChange={setCode}
          isInvalid={failure === "code"}
          errorMessage={t("join.error.code")}
        />
      ) : null}
      <TextField
        label={t("join.displayName")}
        description={t("join.displayNameHelp")}
        autoComplete="given-name"
        isRequired
        value={displayName}
        onChange={setDisplayName}
        isInvalid={failure === "name"}
        errorMessage={t("join.error.name")}
      />
      {failure !== null && failure !== "code" && failure !== "name" ? (
        <p role="alert" className={cx(styles.error)}>
          {t(joinErrorKey(failure))}
        </p>
      ) : null}
      {join.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {t("join.error.other")}
        </p>
      ) : null}
      <div className={cx(styles.actions)}>
        <Button type="submit" isPending={join.isPending}>
          {t("join.submit")}
        </Button>
      </div>
    </form>
  );
}
