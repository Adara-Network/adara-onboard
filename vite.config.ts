import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// 2026-05-05 polish pass: Vite build replaces CDN-Tailwind + CDN-ethers.
// CDN deps were a production-fragility risk (Tailwind explicitly says "not
// for production"); local bundling fixes that and cuts cold-load time.
//
// The dApp is a static SPA — no SSR. `vite build` emits a hashed bundle in
// `dist/` that Cloudflare Pages can serve directly.
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: true,
    // Smaller chunks help Cloudflare Pages's edge cache. ethers v6 is
    // the largest dep; isolating it means a logic-only change doesn't
    // bust the ethers cache for repeat visitors. Vite 8 / rolldown
    // requires a function-form manualChunks rather than the plain map.
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("/node_modules/ethers/")) return "ethers";
          if (id.includes("/node_modules/@walletconnect/")) return "walletconnect";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 4173,
    strictPort: true,
  },
});
