import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
if (
  process.env.VERCEL &&
  (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
)
  throw new Error(
    "Cloud deployment requires Supabase configuration; refuse to publish the local demo.",
  );
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
});
