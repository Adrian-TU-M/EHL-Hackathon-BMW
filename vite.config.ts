import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Customer Agent backend (backend/customer_agent). Override with CUSTOMER_API_TARGET.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const customerApi = {
  "/customer-api": {
    target: env.CUSTOMER_API_TARGET ?? "http://127.0.0.1:8001",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/customer-api/, ""),
  },
};
export default defineConfig({
  plugins: [react()],
  server: { proxy: customerApi },
  preview: { proxy: customerApi },
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
