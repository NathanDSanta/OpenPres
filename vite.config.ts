import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const json = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The version this interface belongs to (set for each release), and which versions work with
  // it (compatibility.json).
  define: {
    __APP_VERSION__: JSON.stringify(json("./package.json").version),
    __COMPATIBILITY__: JSON.stringify(json("./compatibility.json")),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
});
