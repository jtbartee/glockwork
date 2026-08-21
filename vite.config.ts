import { defineConfig } from "vite";

// Relative base so the same build works unmodified from a GitHub Pages subpath
// (https://user.github.io/repo/), a plain static host, or Electron's file:// protocol.
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
