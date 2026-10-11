import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.BMW_API_URL || "http://127.0.0.1:8001",
      "/customer-api": process.env.BMW_API_URL || "http://127.0.0.1:8001",
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
});
