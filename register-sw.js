// register-sw.js
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      // Optional: listen for updates
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed") {
            // If there's an existing controller, it's an update
            if (navigator.serviceWorker.controller) {
              console.info("New content is available; please refresh.");
            } else {
              console.info("Content is cached for offline use.");
            }
          }
        });
      });
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}
