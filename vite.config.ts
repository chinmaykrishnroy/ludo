import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { host: "127.0.0.1", allowedHosts: ["localhost", "127.0.0.1"] },
  build: {
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
