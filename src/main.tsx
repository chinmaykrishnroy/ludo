import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-sans/800.css";
import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import { initFaviconSync } from "./lib/animatedFavicon";
import "./styles.css";

initFaviconSync();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  const register = () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        void reg.update();
        return navigator.serviceWorker.ready;
      })
      .then(() => {
        document.documentElement.dataset.offlineReady = "true";
      })
      .catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
