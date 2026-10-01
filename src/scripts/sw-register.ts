/**
 * Registers the static service worker for offline app shell caching.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      // Service worker registration failures (e.g., non-secure origins) should not interrupt the UI
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Service worker registration failed:", error);
      }
    });
  });
}
