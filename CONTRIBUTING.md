# Contribuire

Grazie dell'interesse. Il progetto è nato per uso privato, quindi le proposte vengono valutate con calma.

- Apri prima una issue se la modifica è grande o cambia il comportamento.
- Installa con `npm install` e `node scripts/uv.mjs sync --project server`.
- Prima di aprire una pull request lancia `npm run check` (tipi, lint e tutti i test): deve passare.
- Commit in formato conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Importi sempre in centesimi interi, testi dell'interfaccia in italiano da `apps/web/src/i18n/it.ts`.
- La logica di dominio sta in `packages/core` (niente rete né browser); i dati passano dall'interfaccia `DataAdapter`.
- Ogni dato è isolato per famiglia in entrambi i backend: un adapter nuovo deve passare la stessa suite di contract test.
- Non inserire mai credenziali, nomi o dati reali: usa solo dati inventati (`example.com`).
- Contribuendo accetti che il tuo codice sia rilasciato con la licenza MIT del progetto.
