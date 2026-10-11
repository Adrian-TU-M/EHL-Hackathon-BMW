import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      "/api/presentations":
        loadEnv(mode, ".", "MODERATOR_").MODERATOR_API_URL ||
        "http://127.0.0.1:8000",
      "/api/moderator":
        loadEnv(mode, ".", "MODERATOR_").MODERATOR_API_URL ||
        "http://127.0.0.1:8000",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          charts: ["recharts"],
          pdf: ["jspdf"],
        },
      },
    },
  },
}));
