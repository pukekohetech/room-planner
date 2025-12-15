// register-sw.js
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    // Register relative to the current folder (works on GitHub Pages subpaths)
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    console.log("✅ SW registered with scope:", reg.scope);

    // Optional: force update check on load
    reg.update?.();
  } catch (err) {
    console.warn("❌ SW registration failed:", err);
  }
}
