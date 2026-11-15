import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Errores de negocio de la economía (códigos de RAISE EXCEPTION y de las rutas). */
export class EconomyError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "EconomyError";
    this.code = code;
    this.status = status;
  }
}

const SQL_ERRORS: Record<string, number> = {
  DAILY_BOX_NOT_AVAILABLE: 409,
  STREAK_BOX_NOT_AVAILABLE: 409,
  USER_BANNED: 403,
  USER_NOT_FOUND: 404,
};

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) {
    const message = String(error.message || "").trim();
    if (message in SQL_ERRORS) throw new EconomyError(message, SQL_ERRORS[message]);
    throw new Error(`Economy RPC ${fn} failed: ${message || "unknown error"}`);
  }
  return data as T;
}

export function economyErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof EconomyError) {
    return NextResponse.json(
      { success: false, error: error.code },
      { status: error.status }
    );
  }
  console.error(`${context}:`, error);
  return NextResponse.json(
    { success: false, error: "INTERNAL_SERVER_ERROR" },
    { status: 500 }
  );
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export type EconomyUser = { id: number; is_banned: boolean; adult_confirmed_at: number | null };

/** Usuario por discord_id (solo los campos que necesita la economía). */
export async function findEconomyUser(discordId: string): Promise<EconomyUser | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, is_banned, adult_confirmed_at")
    .eq("discord_id", discordId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row
    ? { id: row.id, is_banned: Boolean(row.is_banned), adult_confirmed_at: row.adult_confirmed_at ?? null }
    : null;
}
