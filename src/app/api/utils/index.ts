import { requireEnv } from "@/lib/env";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * App Access Token de Kick (client credentials). Solo sirve para datos
 * públicos (estado del directo). Caché en memoria por instancia.
 */
export const getAppAccessToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireEnv("NEXT_PUBLIC_KICK_CLIENT_ID"),
      client_secret: requireEnv("KICK_CLIENT_SECRET"),
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Kick app token request failed (${res.status})`);
  }

  const data = await res.json();
  if (typeof data?.access_token !== "string") {
    throw new Error("Kick app token response without access_token");
  }

  const expiresIn = Number(data.expires_in) || 3600;
  cachedToken = {
    token: data.access_token,
    // Margen de un minuto para no usar un token a punto de caducar.
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
  };

  return cachedToken.token;
};

export const clearAppAccessToken = () => {
  cachedToken = null;
};
