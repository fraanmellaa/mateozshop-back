import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";

import { derivedSecret, requireEnv } from "@/lib/env";

import { HELIX, TWITCH_TOKEN_URL } from "./helix";

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";

function stateSecret() {
  return new TextEncoder().encode(derivedSecret("twitch-state"));
}

/**
 * Twitch no documenta PKCE (solo el flujo de código con client secret), así que
 * no se envía code_challenge: la protección contra CSRF es el `state` firmado,
 * de 10 min y ligado al discord_id, con un nonce aleatorio.
 */
export async function createTwitchAuthUrl(discordId: string) {
  const state = await new SignJWT({
    discord_id: discordId,
    nonce: randomBytes(16).toString("hex"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());

  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("TWITCH_CLIENT_ID"),
    redirect_uri: requireEnv("TWITCH_REDIRECT_URI"),
    // Sin permisos: solo hace falta identificar la cuenta.
    scope: "",
    state,
    // Obliga a elegir cuenta aunque haya una sesión abierta en twitch.tv.
    force_verify: "true",
  });

  return `${TWITCH_AUTHORIZE_URL}?${params.toString()}`;
}

/** ¿Es el state válido y de ese usuario? */
export async function verifyTwitchState(state: string, discordId: string) {
  try {
    const { payload } = await jwtVerify(state, stateSecret(), { algorithms: ["HS256"] });
    return payload.discord_id === discordId && typeof payload.nonce === "string";
  } catch {
    return false;
  }
}

export type TwitchIdentity = {
  twitch_id: string;
  twitch_username: string;
  twitch_created_at: number | null;
};

/** Canjea el código y devuelve la identidad de Twitch del usuario (con su fecha de creación). */
export async function fetchTwitchIdentity(code: string): Promise<TwitchIdentity> {
  const clientId = requireEnv("TWITCH_CLIENT_ID");

  const tokenRes = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: requireEnv("TWITCH_CLIENT_SECRET"),
      redirect_uri: requireEnv("TWITCH_REDIRECT_URI"),
      code,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`Twitch token exchange failed (${tokenRes.status})`);

  const tokens = await tokenRes.json();
  if (typeof tokens?.access_token !== "string") {
    throw new Error("Twitch token response without access_token");
  }

  // Sin parámetros devuelve el usuario dueño del token.
  const userRes = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, "Client-Id": clientId },
    signal: AbortSignal.timeout(10000),
  });
  if (!userRes.ok) throw new Error(`Twitch users request failed (${userRes.status})`);

  const twitchUser = (await userRes.json())?.data?.[0];
  if (typeof twitchUser?.id !== "string" || typeof twitchUser?.login !== "string") {
    throw new Error("Twitch users response without user");
  }

  const created = Date.parse(twitchUser.created_at ?? "");

  // La autorización ya no hace falta: se revoca el token para no dejar acceso vivo.
  void fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, token: tokens.access_token }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);

  return {
    twitch_id: twitchUser.id,
    twitch_username: String(twitchUser.display_name || twitchUser.login),
    twitch_created_at: Number.isFinite(created) ? Math.floor(created / 1000) : null,
  };
}

