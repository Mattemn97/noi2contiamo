// Sito di presentazione: i pulsanti sopra la demo aprono la pagina scelta dentro l'iframe.
const app = document.getElementById("demo-app");
const indirizzo = document.getElementById("demo-indirizzo");
const intera = document.getElementById("demo-intera");
const pulsanti = document.querySelectorAll("[data-pagina]");

function apri(pagina) {
  const hash = `#${pagina}`;
  // Stessa origine: si cambia solo l'hash, senza ricaricare la demo né perdere quello che si è modificato.
  try {
    app.contentWindow.location.hash = hash;
  } catch {
    app.src = `demo/${hash}`;
  }
  indirizzo.textContent = `noi2contiamo/demo${pagina === "/" ? "" : pagina}`;
  intera.href = `demo/${hash}`;
  pulsanti.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pagina === pagina)));
}

pulsanti.forEach((b) => b.addEventListener("click", () => apri(b.dataset.pagina)));
