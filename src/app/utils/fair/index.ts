import { getSupabaseAdmin } from "@/lib/supabase/admin";

export * from "./rng";

/**
 * Estado de las semillas verificables de un usuario. Las funciones SQL viven
 * en migrations/0019_foundation.sql.
 *
 * `fairReserve` devuelve la semilla SECRETA de servidor: úsala solo para
 * calcular resultados dentro del servidor y no la incluyas jamás en una
 * respuesta HTTP. Lo que sí se puede mostrar es `server_seed_hash`.
 */

export type FairState = {
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
};

export type FairReservation = {
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  /** Primer nonce reservado; se reservan `count` consecutivos. */
  nonce_start: number;
};

export type FairRotation = {
  revealed: {
    server_seed: string;
    server_seed_hash: string;
    client_seed: string;
    nonce_end: number;
  };
  current: FairState;
};

export type RevealedSeed = FairRotation["revealed"] & { revealed_at: number };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw new Error(error.message || fn);
  return data as T;
}

/** Hash de la semilla de servidor, semilla de cliente y nonce actual (público). */
export function fairState(userId: number) {
  return rpc<FairState>("fair_state", { p_user_id: userId });
}

/** Reserva `count` (1–1000) nonces de forma atómica. Incluye la semilla secreta. */
export function fairReserve(userId: number, count = 1) {
  return rpc<FairReservation>("fair_reserve", { p_user_id: userId, p_count: count });
}

/** Cambia la semilla de cliente (1–64 caracteres: letras, números, _ y -). */
export function fairSetClientSeed(userId: number, clientSeed: string) {
  return rpc<FairState>("fair_set_client_seed", {
    p_user_id: userId,
    p_client_seed: clientSeed,
  });
}

/** Rota la semilla de servidor: revela la anterior y reinicia el nonce. */
export function fairRotate(userId: number, clientSeed?: string) {
  return rpc<FairRotation>("fair_rotate", {
    p_user_id: userId,
    p_client_seed: clientSeed ?? null,
  });
}

/** Semillas de servidor ya reveladas (más recientes primero). */
export async function fairHistory(userId: number, limit = 20): Promise<RevealedSeed[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("fair_seed_history")
    .select("server_seed, server_seed_hash, client_seed, nonce_end, revealed_at")
    .eq("user_id", userId)
    .order("revealed_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return (data ?? []) as RevealedSeed[];
}
