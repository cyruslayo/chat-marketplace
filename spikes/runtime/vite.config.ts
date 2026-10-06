import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [cloudflare()], server: { port: 5183, strictPort: true } });
