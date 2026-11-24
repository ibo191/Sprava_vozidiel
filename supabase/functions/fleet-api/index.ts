import { createClient } from "@supabase/supabase-js";
import { createCloudHandler } from "./server/cloud-handler.ts";

// Only the Edge runtime receives the server key. It never enters the Vite build.
const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!key) throw new Error("Missing server credential");
const db = createClient(Deno.env.get("SUPABASE_URL")!, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createCloudHandler(db));
