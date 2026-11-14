import { createHash, createHmac, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";

import { derivedSecret, requireEnv } from "@/lib/env";

const KICK_AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_USERS_URL = "https://api.kick.com/public/v1/users";

function stateSecret() {
  return new TextEncoder().encode(derivedSecret("kick-state"));
}

/**
 * El `code_verifier` de PKCE no se guarda ni viaja en el `state`: se deriva
 * con HMAC del nonce del state y un secreto del servidor, así que solo el back
 * puede reconstruirlo.
 */
function codeVerifierFor(discordId: string, nonce: string) {
  return createHmac("sha256", derivedSecret("kick-pkce"))
    .update(`${discordId}:${nonce}`)
    .digest("base64url");
}

/** `state` firmado (10 min, ligado al discord_id) y URL de autorización. */
export async function createKickAuthUrl(discordId: string) {
  const nonce = randomBytes(16).toString("hex");

  const state = await new SignJWT({ discord_id: discordId, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());

  const codeChallenge = createHash("sha256")
    .update(codeVerifierFor(discordId, nonce))
    .digest("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("NEXT_PUBLIC_KICK_CLIENT_ID"),
    redirect_uri: requireEnv("KICK_REDIRECT_URI"),
    scope: "user:read",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `${KICK_AUTHORIZE_URL}?${params.toString()}`;
}

/** Devuelve el `code_verifier` si el state es válido y es de ese usuario. */
export async function verifyKickState(state: string, discordId: string) {
  try {
    const { payload } = await jwtVerify(state, stateSecret(), {
      algorithms: ["HS256"],
    });

    if (payload.discord_id !== discordId || typeof payload.nonce !== "string") {
      return null;
    }

    return codeVerifierFor(discordId, payload.nonce);
  } catch {
    return null;
  }
}

/** Canjea el código y devuelve la identidad de Kick del usuario. */
export async function fetchKickIdentity(code: string, codeVerifier: string) {
  const tokenRes = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: requireEnv("NEXT_PUBLIC_KICK_CLIENT_ID"),
      client_secret: requireEnv("KICK_CLIENT_SECRET"),
      redirect_uri: requireEnv("KICK_REDIRECT_URI"),
      code_verifier: codeVerifier,
      code,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!tokenRes.ok) {
    throw new Error(`Kick token exchange failed (${tokenRes.status})`);
  }

  const tokens = await tokenRes.json();
  if (typeof tokens?.access_token !== "string") {
    throw new Error("Kick token response without access_token");
  }

  // Sin parámetros devuelve el usuario dueño del token.
  const userRes = await fetch(KICK_USERS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!userRes.ok) {
    throw new Error(`Kick users request failed (${userRes.status})`);
  }

  const body = await userRes.json();
  const kickUser = body?.data?.[0];

  if (kickUser?.user_id == null || typeof kickUser?.name !== "string") {
    throw new Error("Kick users response without user");
  }

  return { kick_id: String(kickUser.user_id), kick_username: kickUser.name };
}
