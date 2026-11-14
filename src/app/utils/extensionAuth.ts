import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

import { requireEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type ExtensionUser = {
  id: number;
  discord_id: string;
  username: string;
  image: string;
  email: string;
  kick_id: string | null;
  kick_username: string | null;
  total_points: number;
  used_points: number;
  is_banned: boolean;
  /** Saldo disponible: total_points - used_points. */
  points: number;
};

function extensionSecret() {
  return new TextEncoder().encode(requireEnv("EXTENSION_JWT_SECRET"));
}

export async function signExtensionToken(discordId: string) {
  return new SignJWT({ discordId, role: "extension-user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(discordId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(extensionSecret());
}

export function extensionError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Autentica una petición de la extensión y carga su usuario de BD.
 * No rechaza a los baneados: cada ruta decide (usa `user.is_banned`).
 */
export async function requireExtensionUser(
  request: NextRequest
): Promise<{ ok: true; user: ExtensionUser } | { ok: false; response: NextResponse }> {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return { ok: false, response: extensionError("EXTENSION_TOKEN_REQUIRED", 401) };
  }

  let discordId: string | null = null;
  try {
    const { payload } = await jwtVerify(match[1], extensionSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.role === "extension-user" && typeof payload.discordId === "string") {
      discordId = payload.discordId;
    }
  } catch {
    discordId = null;
  }

  if (!discordId) {
    return { ok: false, response: extensionError("INVALID_EXTENSION_TOKEN", 401) };
  }

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select(
      "id, discord_id, username, image, email, kick_id, kick_username, total_points, used_points, is_banned"
    )
    .eq("discord_id", discordId)
    .limit(1);

  if (error) {
    console.error("Error loading extension user:", error);
    return { ok: false, response: extensionError("INTERNAL_SERVER_ERROR", 500) };
  }

  const row = data?.[0];
  if (!row) {
    return { ok: false, response: extensionError("USER_NOT_FOUND", 404) };
  }

  const total = Number(row.total_points || 0);
  const used = Number(row.used_points || 0);

  return {
    ok: true,
    user: {
      id: row.id,
      discord_id: row.discord_id,
      username: row.username,
      image: row.image,
      email: row.email,
      kick_id: row.kick_id ?? null,
      kick_username: row.kick_username ?? null,
      total_points: total,
      used_points: used,
      is_banned: Boolean(row.is_banned),
      points: total - used,
    },
  };
}
