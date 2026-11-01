import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", allowedHosts: ["localhost", "127.0.0.1"] },
  build: {
    // AudioWorklet modules must remain same-origin files under the production CSP.
    assetsInlineLimit: (path) =>
      path.endsWith("liveVoice.worklet.js") ? false : undefined,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("socket.io") || id.includes("engine.io"))
              return "realtime";
            if (id.includes("motion")) return "animation";
            if (id.includes("phosphor")) return "icons";
            if (id.includes("react")) return "react";
          }
        },
      },
    },
  },
});
