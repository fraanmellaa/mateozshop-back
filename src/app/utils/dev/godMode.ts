import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rpc } from "@/app/utils/economy/db";
import { getEconomySettings } from "@/app/utils/economy/settings";
import { adDay } from "@/app/utils/economy/time";
import { creditPoints } from "@/app/utils/points";
import { createUser } from "@/app/utils/users";

/**
 * MODO DIOS: solo desarrollo local. Un único usuario de pruebas, fijo, con todo
 * lo necesario para probar la web sin pasar por Discord. Todo lo del modo dios
 * pasa por `isGodMode()`; en producción es inerte aunque la variable esté puesta.
 */

/**
 * true SOLO con GOD_MODE=1, fuera de producción y fuera de Vercel. Falla en
 * cerrado: `next build`/`next start` fijan NODE_ENV=production.
 */
export function isGodMode(): boolean {
  return (
    process.env.GOD_MODE === "1" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV
  );
}

/** El usuario de pruebas. Fijo: nunca se elige desde fuera. */
export const GOD_USER = {
  discordId: "100000000000000001",
  name: "GOD MODE (test)",
  email: "god-mode@test.invalid",
  // Id no numérico: no puede coincidir con una cuenta real de Kick.
  kickId: "god-mode-100000000000000001",
  kickUsername: "god_mode_test",
  // Formato válido (partner numérico + token de 8 caracteres), cuenta inexistente.
  steamTradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=GODMODE0",
} as const;

const DAY_SECONDS = 86400;
// Más que el máximo configurable de `shop.minAccountAgeDays` (3650).
const LINKED_DAYS_AGO = 4000;
const MIN_BALANCE = 100_000;
const TARGET_BALANCE = 1_000_000;

export type GodUserState = { id: number; balance: number };

function assertGodMode() {
  if (!isGodMode()) throw new Error("GOD_MODE_DISABLED");
}

/** Sube el saldo hasta el objetivo por la vía oficial (`points_move`, kind admin_add). */
async function topUp(userId: number, balance: number): Promise<number> {
  if (balance >= TARGET_BALANCE) return balance;
  return creditPoints(userId, TARGET_BALANCE - balance, {
    kind: "admin_add",
    refType: "god_mode",
    meta: { source: "god_mode" },
  });
}

/**
 * Crea el usuario de pruebas si no existe (mismo camino que el registro:
 * `createUser`) y lo deja listo: +18 y términos, Kick "vinculado" hace años,
 * enlace de Steam, sin baneo y con saldo. Idempotente.
 */
export async function ensureGodUser(options: { refill?: boolean } = {}): Promise<GodUserState> {
  assertGodMode();

  const user = await createUser({
    name: GOD_USER.name,
    user_id: GOD_USER.discordId,
    profile_picture: "",
    email: GOD_USER.email,
    adult_confirmed: true,
    terms_accepted: true,
  });
  if (!user) throw new Error("GOD_USER_NOT_CREATED");

  const nowSec = Math.floor(Date.now() / 1000);
  const oldEnough = nowSec - LINKED_DAYS_AGO * DAY_SECONDS;
  const patch: Record<string, unknown> = {};

  if (user.is_banned) patch.is_banned = false;
  if (!user.adult_confirmed_at) patch.adult_confirmed_at = nowSec;
  if (!user.terms_accepted_at) patch.terms_accepted_at = nowSec;
  if (!user.kick_id) {
    patch.kick_id = GOD_USER.kickId;
    patch.kick_username = GOD_USER.kickUsername;
  }
  // Kick no expone la fecha de creación: la antigüedad es la de vinculación.
  if (!user.kick_linked_at || user.kick_linked_at > oldEnough) {
    patch.kick_linked_at = oldEnough;
  }
  if (!user.steam_trade_url?.trim()) patch.steam_trade_url = GOD_USER.steamTradeUrl;

  if (Object.keys(patch).length > 0) {
    // Doble filtro: solo puede tocar la fila del usuario de pruebas.
    const { error } = await getSupabaseAdmin()
      .from("users")
      .update(patch)
      .eq("id", user.id)
      .eq("discord_id", GOD_USER.discordId);
    if (error) throw error;
  }

  let balance = user.actual_points;
  if (options.refill || balance < MIN_BALANCE) {
    balance = await topUp(user.id, balance);
  }

  return { id: user.id, balance };
}

export type GodBoxesState = {
  /** Día de directo de referencia (null: la BD no tiene ningún directo registrado). */
  liveDay: string | null;
  dailyBox: boolean;
  notes: string[];
};

/**
 * Deja al usuario de pruebas con la caja diaria disponible y una racha viva.
 * Solo escribe filas SUYAS (user_watch_days, daily_box_claims, user_streaks);
 * no toca tablas globales ni funciones SQL.
 */
export async function prepareGodBoxes(): Promise<GodBoxesState> {
  assertGodMode();

  const { id: userId } = await ensureGodUser();
  const supabase = getSupabaseAdmin();
  const settings = await getEconomySettings();
  const nowSec = Math.floor(Date.now() / 1000);
  const today = adDay();
  const notes: string[] = [];

  const liveDay = (await rpc<string | null>("economy_live_day", {})) ?? null;
  const minutes = Math.max(settings.minutes.dailyBox, settings.minutes.streak);

  // Minutos vistos: hoy (elegibilidad del torneo) y el día de directo (caja diaria).
  const days = liveDay && liveDay !== today ? [today, liveDay] : [today];
  const watch = await supabase
    .from("user_watch_days")
    .upsert(
      days.map((day) => ({ user_id: userId, day, minutes })),
      { onConflict: "user_id,day" }
    );
  if (watch.error) throw watch.error;

  let dailyBox = false;
  if (liveDay) {
    // Quita la reclamación de ese día para poder abrirla otra vez.
    const claim = await supabase
      .from("daily_box_claims")
      .delete()
      .eq("user_id", userId)
      .eq("day", liveDay)
      .select("id");
    if (claim.error) throw claim.error;
    if ((claim.data?.length ?? 0) > 0) {
      notes.push(
        "La caja diaria de este día de directo ya se había abierto: al repetirla se sortea y se registra, pero points_move no vuelve a abonar los puntos (misma clave de idempotencia)."
      );
    }
    dailyBox = true;

    // Racha viva de varios días: su último día es el día de directo de referencia.
    const current = 4;
    const prev = await supabase
      .from("user_streaks")
      .select("best_streak")
      .eq("user_id", userId)
      .limit(1);
    if (prev.error) throw prev.error;
    const streak = await supabase.from("user_streaks").upsert(
      {
        user_id: userId,
        current_streak: current,
        best_streak: Math.max(current, Number(prev.data?.[0]?.best_streak ?? 0)),
        last_day: liveDay,
        updated_at: nowSec,
      },
      { onConflict: "user_id" }
    );
    if (streak.error) throw streak.error;
  } else {
    notes.push(
      "La BD no tiene ningún día de directo (stream_sessions/live_days vacías): la caja diaria no puede estar disponible sin escribir en tablas globales."
    );
  }

  return { liveDay, dailyBox, notes };
}
