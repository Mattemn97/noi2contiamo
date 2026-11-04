// Le route protette: serve una sessione, e per le pagine dei dati anche una famiglia.
import type { FamilySummary } from "@noi2contiamo/data";
import { Navigate, Outlet, useLocation, useOutletContext } from "react-router";
import { useFamilies, useSession } from "../data/queries";
import { t } from "../i18n/it";
import { AppShell, ErrorState, NAV_ITEMS, Skeleton, type NavId } from "../ui";
import { pickActiveFamily, readActiveFamily } from "./family/invite";

export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <Skeleton lines={4} />;
  if (session.isError)
    return <ErrorState description={t("auth.error.unavailable")} onRetry={() => void session.refetch()} />;
  if (!session.data) return <Navigate to="/accedi" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function navFor(pathname: string): NavId | undefined {
  const exact = NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) return exact.id;
  return NAV_ITEMS.filter((item) => item.href !== "/" && pathname.startsWith(item.href)).at(-1)?.id;
}

export function RequireFamily() {
  const families = useFamilies();
  const { pathname } = useLocation();
  const family = families.data ? pickActiveFamily(families.data, readActiveFamily()) : undefined;
  let body;
  if (families.isPending) body = <Skeleton lines={4} />;
  else if (families.isError) body = <ErrorState onRetry={() => void families.refetch()} />;
  else if (!family) return <Navigate to="/benvenuto" replace />;
  else body = <Outlet context={family} />;
  return <AppShell current={navFor(pathname)}>{body}</AppShell>;
}

/** La famiglia attiva, data dal layout `RequireFamily` (l'ultima scelta su questo dispositivo, o la prima). */
export function useFamily(): FamilySummary {
  return useOutletContext<FamilySummary>();
}
