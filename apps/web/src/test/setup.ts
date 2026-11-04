// Preparazione dei test del web in jsdom: pulizia del DOM e API del browser che jsdom non ha.
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// I test nel DOM girano in parallelo: su un portatile lento (o a batteria) 1 s per `findBy` e 5 s per test
// non bastano. Margini larghi, nessun effetto sui test che passano subito.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, writable: true });
}

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
