import { NextRequest } from "next/server";
import { z } from "zod";

import { extensionError, signExtensionToken } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";
import { createUser, getUserByDiscordId } from "@/app/utils/users";
import { requireEnv } from "@/lib/env";

const bodySchema = z.object({
  code: z.string().min(1).max(512),
  // Solo la URL de retorno de `chrome.identity.launchWebAuthFlow`.
  redirectUri: z
    .string()
    .max(200)
    .regex(/^https:\/\/[a-p]{32}\.chromiumapp\.org\//),
});

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
};

/** Fallo del login con Discord atribuible al usuario o a Discord, con código público. */
class DiscordAuthError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

function buildDiscordAvatarUrl(discordUser: DiscordUser) {
  if (discordUser.avatar) {
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`;
  }
  return "https://cdn.discordapp.com/embed/avatars/0.png";
}

async function exchangeCodeForToken(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: requireEnv("DISCORD_CLIENT_ID"),
    client_secret: requireEnv("DISCORD_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) throw new DiscordAuthError("DISCORD_AUTH_FAILED", 400);

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new DiscordAuthError("DISCORD_AUTH_FAILED", 400);

  return tokenJson.access_token;
}

async function fetchDiscordMe(accessToken: string) {
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!meRes.ok) throw new DiscordAuthError("DISCORD_AUTH_FAILED", 502);

  const me = (await meRes.json()) as DiscordUser;
  if (!me.id || !me.username) throw new DiscordAuthError("DISCORD_AUTH_FAILED", 502);
  if (!me.email) throw new DiscordAuthError("DISCORD_EMAIL_REQUIRED", 400);

  return me;
}

/** Crea el usuario si no existe o refresca su perfil. No toca puntos. */
async function upsertUserFromDiscord(me: DiscordUser) {
  const username = me.global_name || me.username;
  const image = buildDiscordAvatarUrl(me);
  const email = me.email as string;

  // createUser da de alta o actualiza el perfil y resuelve los choques de
  // `username` (UNIQUE) sin fallar; el email de un usuario existente no se toca.
  try {
    await createUser({ name: username, user_id: me.id, profile_picture: image, email });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
      throw new DiscordAuthError("EMAIL_ALREADY_REGISTERED", 409);
    }
    // La cuenta se crea en la web, donde se confirma la mayoría de edad.
    if (error instanceof Error && error.message === "ADULT_CONFIRMATION_REQUIRED") {
      throw new DiscordAuthError("ADULT_CONFIRMATION_REQUIRED", 403);
    }
    throw error;
  }

  return getUserByDiscordId(me.id);
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return extensionError("INVALID_REQUEST_BODY", 400);

  try {
    const accessToken = await exchangeCodeForToken(parsed.data.code, parsed.data.redirectUri);
    const discordMe = await fetchDiscordMe(accessToken);
    const user = await upsertUserFromDiscord(discordMe);
    if (!user) return extensionError("INTERNAL_SERVER_ERROR", 500);

    return extensionOk({
      token: await signExtensionToken(discordMe.id),
      user: {
        discord_id: user.discord_id,
        username: user.username,
        image: user.image,
        points: user.actual_points,
      },
    });
  } catch (error) {
    if (error instanceof DiscordAuthError) return extensionError(error.code, error.status);
    console.error("Extension Discord exchange failed:", error);
    return extensionError("INTERNAL_SERVER_ERROR", 500);
  }
}
