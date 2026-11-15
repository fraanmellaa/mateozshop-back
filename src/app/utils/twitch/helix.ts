import { requireEnv } from "@/lib/env";

export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const HELIX = "https://api.twitch.tv/helix";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Token de aplicación de Twitch (client credentials). Sirve para datos públicos
 * (estado del directo) y para crear suscripciones EventSub por webhook. Caché en
 * memoria por instancia.
 */
export async function getTwitchAppToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("TWITCH_CLIENT_ID"),
      client_secret: requireEnv("TWITCH_CLIENT_SECRET"),
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Twitch app token request failed (${res.status})`);

  const data = await res.json();
  if (typeof data?.access_token !== "string") {
    throw new Error("Twitch app token response without access_token");
  }

  const expiresIn = Number(data.expires_in) || 3600;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
  };
  return cachedToken.token;
}

export function clearTwitchAppToken() {
  cachedToken = null;
}

/** Llamada a Helix con el token de aplicación; renueva el token una vez si caduca. */
export async function helixAppFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const call = async () =>
    fetch(`${HELIX}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
        Authorization: `Bearer ${await getTwitchAppToken()}`,
        "Client-Id": requireEnv("TWITCH_CLIENT_ID"),
      },
      signal: init.signal ?? AbortSignal.timeout(10000),
    });

  const res = await call();
  if (res.status !== 401) return res;
  clearTwitchAppToken();
  return call();
}

/** ¿Está el canal en directo en Twitch? Lanza si la API falla. */
export async function fetchTwitchLive(): Promise<boolean> {
  const broadcasterId = requireEnv("TWITCH_BROADCASTER_ID");
  const res = await helixAppFetch(`/streams?user_id=${encodeURIComponent(broadcasterId)}`);
  if (!res.ok) throw new Error(`Twitch streams request failed (${res.status})`);

  const body = await res.json();
  return body?.data?.[0]?.type === "live";
}
