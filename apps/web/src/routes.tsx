// Le route della SPA (react-router in modalità data router, senza framework mode: spec 0001).
import type { RouteObject } from "react-router";
import { AuthPage } from "./features/auth/AuthPage";
import { BalancePage } from "./features/balance/BalancePage";
import { AccountsPage } from "./features/catalog/AccountsPage";
import { CategoriesPage } from "./features/catalog/CategoriesPage";
import { PayeesPage } from "./features/catalog/PayeesPage";
import { CreateFamilyPage } from "./features/family/CreateFamilyPage";
import { FamilyPage } from "./features/family/FamilyPage";
import { JoinPage } from "./features/family/JoinPage";
import { ImportPage } from "./features/import/ImportPage";
import { RequireFamily, RequireSession } from "./features/guards";
import { ForecastPage } from "./features/recurring/ForecastPage";
import { RecurrenceEditorPage } from "./features/recurring/RecurrenceEditorPage";
import { RecurringPage } from "./features/recurring/RecurringPage";
import { SuggestionsPage } from "./features/recurring/SuggestionsPage";
import { RuleEditorPage } from "./features/rules/RuleEditorPage";
import { RulesPage } from "./features/rules/RulesPage";
import { MorePage, NotFoundPage, OverviewPage, PersonalPage } from "./features/more/pages";
import { EditTransactionPage, NewTransactionPage } from "./features/transactions/NewTransactionPage";
import { TransactionsPage } from "./features/transactions/TransactionsPage";

export const routes: RouteObject[] = [
  { path: "/accedi", element: <AuthPage mode="login" /> },
  { path: "/registrati", element: <AuthPage mode="register" /> },
  {
    element: <RequireSession />,
    children: [
      { path: "/benvenuto", element: <CreateFamilyPage /> },
      { path: "/invito/:code", element: <JoinPage /> },
      {
        element: <RequireFamily />,
        children: [
          { path: "/", element: <OverviewPage /> },
          { path: "/movimenti", element: <TransactionsPage /> },
          { path: "/movimenti/nuovo", element: <NewTransactionPage /> },
          { path: "/movimenti/:id", element: <EditTransactionPage /> },
          { path: "/saldo", element: <BalancePage /> },
          { path: "/importa", element: <ImportPage /> },
          { path: "/personale", element: <PersonalPage /> },
          { path: "/altro", element: <MorePage /> },
          { path: "/altro/famiglia", element: <FamilyPage /> },
          { path: "/altro/conti", element: <AccountsPage /> },
          { path: "/altro/categorie", element: <CategoriesPage /> },
          { path: "/altro/destinatari", element: <PayeesPage /> },
          { path: "/ricorrenti", element: <RecurringPage /> },
          { path: "/ricorrenti/suggerimenti", element: <SuggestionsPage /> },
          { path: "/ricorrenti/:id", element: <RecurrenceEditorPage /> },
          { path: "/previsioni", element: <ForecastPage /> },
          { path: "/altro/regole", element: <RulesPage /> },
          { path: "/altro/regole/:id", element: <RuleEditorPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];
