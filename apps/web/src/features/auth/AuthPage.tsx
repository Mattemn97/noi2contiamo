// Accesso e registrazione con email e password (spec 0001: Argon2id e cookie HttpOnly nel server).
import { AuthError } from "@noi2contiamo/data";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { useResetAfterAuth, useSession } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import { Button, Card, Link, PageHeader, TextField } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";

export type AuthMode = "login" | "register";

export function authErrorKey(error: unknown): MessageKey {
  return error instanceof AuthError ? `auth.error.${error.code}` : "auth.error.unavailable";
}

export function AuthPage({ mode }: { readonly mode: AuthMode }) {
  const adapter = useAdapter();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const resetAfterAuth = useResetAfterAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Da dove si arriva (per esempio un link di invito): dallo stato della navigazione o da `?da=`.
  const asked =
    (location.state as { from?: string } | null)?.from ?? new URLSearchParams(location.search).get("da");
  const from = asked?.startsWith("/") === true && !asked.startsWith("//") ? asked : null;
  const keep = from ? `?da=${encodeURIComponent(from)}` : "";

  const submit = useMutation({
    mutationFn: () =>
      mode === "login" ? adapter.auth.signIn(email, password) : adapter.auth.signUp(email, password),
    onSuccess: async (user) => {
      resetAfterAuth(user);
      await navigate(from ?? (mode === "login" ? "/" : "/benvenuto"), { replace: true });
    },
  });

  if (session.data) return <Navigate to={from ?? "/"} replace />;

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    submit.mutate();
  };
  const isLogin = mode === "login";

  return (
    <main className={cx(styles.center)}>
      <div className={cx(styles.narrow)}>
        <PageHeader
          title={t(isLogin ? "auth.login.title" : "auth.register.title")}
          subtitle={t(isLogin ? "auth.login.subtitle" : "auth.register.subtitle")}
        />
        <Card>
          <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
            <TextField
              label={t("auth.email")}
              type="email"
              autoComplete="email"
              isRequired
              value={email}
              onChange={setEmail}
            />
            <TextField
              label={t("auth.password")}
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              description={isLogin ? undefined : t("auth.passwordHelp")}
              isRequired
              value={password}
              onChange={setPassword}
            />
            {submit.isError ? (
              <p role="alert" className={cx(styles.error)}>
                {t(authErrorKey(submit.error))}
              </p>
            ) : null}
            <div className={cx(styles.actions)}>
              <Button type="submit" isPending={submit.isPending}>
                {t(isLogin ? "auth.submitLogin" : "auth.submitRegister")}
              </Button>
              <Link href={`${isLogin ? "/registrati" : "/accedi"}${keep}`}>
                {t(isLogin ? "auth.toRegister" : "auth.toLogin")}
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
