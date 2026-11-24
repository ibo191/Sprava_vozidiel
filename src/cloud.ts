import { createClient } from "@supabase/supabase-js";

const env = (import.meta as unknown as { env: Record<string, string> }).env;
export const cloud = Boolean(
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const auth = cloud
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  : null;
export const apiBase = cloud
  ? `${env.VITE_SUPABASE_URL}/functions/v1/fleet-api/api`
  : "/api";

export async function apiFetch(path: string, init: RequestInit = {}) {
  const session = auth ? (await auth.auth.getSession()).data.session : null;
  return fetch(apiBase + path, {
    ...init,
    headers: {
      ...init.headers,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });
}
export async function api<T = any>(path: string, body?: any): Promise<T> {
  if (auth && path === "/login") {
    const { error } = await auth.auth.signInWithPassword(body);
    if (error) throw new Error("Nesprávný e-mail nebo heslo.");
    try {
      return await api<T>("/me");
    } catch (e) {
      await auth.auth.signOut();
      throw e;
    }
  }
  if (auth && path === "/logout") {
    await auth.auth.signOut();
    return { ok: true } as T;
  }
  if (auth && path === "/reset-request") {
    const { error } = await auth.auth.resetPasswordForEmail(body.email, {
      redirectTo: window.location.origin + "/obnova",
    });
    if (error)
      throw new Error(
        "Obnovu nyní nelze odeslat. Zkuste to později nebo kontaktujte administrátora.",
      );
    return {
      message:
        "Pokud účet existuje, obdržíte e-mail s odkazem pro obnovu hesla.",
    } as T;
  }
  if (auth && path === "/reset-password") {
    const { error } = await auth.auth.updateUser({ password: body.password });
    if (error)
      throw new Error(
        "Heslo se nepodařilo změnit. Otevřete nový odkaz pro obnovu.",
      );
    await auth.auth.signOut();
    return { ok: true } as T;
  }
  const r = await apiFetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Požadavek selhal.");
  return data;
}
export async function openPrivate(path: string, download = false) {
  const r = await apiFetch(path);
  if (!r.ok) {
    const b = await r.json();
    throw new Error(b.error ?? "Soubor nelze otevřít.");
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  if (download) a.download = path.split("/").pop() + ".csv";
  else a.target = "_blank";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
