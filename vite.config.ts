import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  server: {
    watch: { ignored: ["**/backend/**", "**/.venv/**", "**/.local-dependencies/**"] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if ("writeHead" in response && !response.headersSent) {
              response.writeHead(503, { "Content-Type": "application/json" });
              response.end(JSON.stringify({
                detail: "FastAPI is unavailable on port 8000. Stop the frontend and run npm run dev to set up and start both services, or npm run dev:full with configured live adapters. Check the terminal for Python setup errors.",
              }));
            }
          });
        },
      },
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
