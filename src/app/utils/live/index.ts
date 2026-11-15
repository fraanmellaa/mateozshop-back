import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchLiveStatus as fetchKickLive } from "@/app/utils/kick/live";
import { fetchTwitchLive } from "@/app/utils/twitch/helix";

import { maintainStreamerConnections } from "./connections";
import { andorraDay } from "./time";

type Platform = "kick" | "twitch";

// Lecturas "no está en directo" seguidas antes de cerrar una sesión abierta.
// Con el tick cada minuto, un fallo puntual de la API nunca corta el directo.
const CLOSE_AFTER_MISSES = 2;
// Si la plataforma lleva más de esto sin responder bien, se da el directo por
// terminado (si no, una sesión abierta se quedaría así para siempre).
const CLOSE_AFTER_ERROR_SECONDS = 15 * 60;

export type LiveState = {
  live: boolean;
  kick: boolean;
  twitch: boolean;
  sessions: { kick: number | null; twitch: number | null };
  day: string;
};

type Reading = { configured: false } | { configured: true; ok: true; live: boolean } | { configured: true; ok: false; error: string };

async function readPlatform(platform: Platform): Promise<Reading> {
  const needed =
    platform === "kick"
      ? ["KICK_BROADCASTER_USER_ID", "NEXT_PUBLIC_KICK_CLIENT_ID", "KICK_CLIENT_SECRET"]
      : ["TWITCH_BROADCASTER_ID", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"];
  if (needed.some((name) => !process.env[name])) return { configured: false };

  try {
    const live = platform === "kick" ? await fetchKickLive() : await fetchTwitchLive();
    return { configured: true, ok: true, live };
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type OpenSession = { id: number } | null;

async function getOpenSession(platform: Platform): Promise<OpenSession> {
  const { data, error } = await getSupabaseAdmin()
    .from("stream_sessions")
    .select("id")
    .eq("platform", platform)
    .is("ended_at", null)
    .limit(1);
  if (error) throw error;
  return data?.[0] ? { id: Number(data[0].id) } : null;
}

async function openSession(platform: Platform, now: number): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  const day = andorraDay(now);

  const { data, error } = await supabase
    .from("stream_sessions")
    .insert({ platform, started_at: now, day })
    .select("id")
    .limit(1);

  if (error) {
    // Otra ejecución simultánea la abrió primero (índice único de sesión abierta).
    if (error.code === "23505") return (await getOpenSession(platform))?.id ?? null;
    throw error;
  }

  // El primer directo del día fija la fila; los siguientes no la tocan.
  const { error: dayError } = await supabase
    .from("live_days")
    .upsert({ day, first_started_at: now }, { onConflict: "day", ignoreDuplicates: true });
  if (dayError) throw dayError;

  return data?.[0] ? Number(data[0].id) : null;
}

async function updateState(platform: Platform, values: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin()
    .from("live_state")
    .upsert({ platform, ...values }, { onConflict: "platform" });
  if (error) throw error;
}

async function getState(platform: Platform) {
  const { data, error } = await getSupabaseAdmin()
    .from("live_state")
    .select("misses, last_ok_at")
    .eq("platform", platform)
    .limit(1);
  if (error) throw error;
  return {
    misses: Number(data?.[0]?.misses ?? 0),
    lastOkAt: data?.[0]?.last_ok_at == null ? null : Number(data[0].last_ok_at),
  };
}

async function closeSession(id: number, now: number) {
  const { error } = await getSupabaseAdmin()
    .from("stream_sessions")
    .update({ ended_at: now })
    .eq("id", id)
    .is("ended_at", null);
  if (error) throw error;
}

/** Reconcilia una plataforma con su sesión abierta y devuelve el id de sesión vigente. */
async function syncPlatform(platform: Platform, now: number): Promise<number | null> {
  const reading = await readPlatform(platform);
  const open = await getOpenSession(platform);

  if (!reading.configured) {
    // Sin credenciales no hay forma de saber nada: una sesión huérfana se cierra.
    if (open) await closeSession(open.id, now);
    return null;
  }

  if (!reading.ok) {
    console.error(`Live status (${platform}) unavailable:`, reading.error);
    const state = await getState(platform);
    await updateState(platform, { last_error: reading.error.slice(0, 300), last_error_at: now });
    if (open && state.lastOkAt !== null && now - state.lastOkAt > CLOSE_AFTER_ERROR_SECONDS) {
      await closeSession(open.id, now);
      return null;
    }
    return open?.id ?? null;
  }

  if (reading.live) {
    await updateState(platform, { misses: 0, last_ok_at: now, last_error: null });
    return open ? open.id : openSession(platform, now);
  }

  if (!open) {
    await updateState(platform, { misses: 0, last_ok_at: now, last_error: null });
    return null;
  }

  const { misses } = await getState(platform);
  const next = misses + 1;
  if (next >= CLOSE_AFTER_MISSES) {
    await closeSession(open.id, now);
    await updateState(platform, { misses: 0, last_ok_at: now, last_error: null });
    return null;
  }
  await updateState(platform, { misses: next, last_ok_at: now, last_error: null });
  return open.id;
}

/**
 * Consulta Kick y Twitch, abre/cierra `stream_sessions` y registra `live_days`
 * (día de Andorra) al empezar el primer directo del día. Una plataforma que
 * falla no cierra su directo de golpe: hacen falta varias lecturas negativas
 * seguidas (o un cuarto de hora sin respuesta) para darlo por terminado.
 * También mantiene al día las conexiones del streamer (tokens, suscripciones).
 */
export async function syncLiveState(): Promise<LiveState> {
  const now = Math.floor(Date.now() / 1000);

  const [kick, twitch] = await Promise.allSettled([syncPlatform("kick", now), syncPlatform("twitch", now)]);
  const kickId = kick.status === "fulfilled" ? kick.value : null;
  const twitchId = twitch.status === "fulfilled" ? twitch.value : null;
  if (kick.status === "rejected") console.error("syncLiveState kick failed:", kick.reason);
  if (twitch.status === "rejected") console.error("syncLiveState twitch failed:", twitch.reason);

  try {
    await maintainStreamerConnections();
  } catch (error) {
    console.error("maintainStreamerConnections failed:", error);
  }

  return {
    live: kickId !== null || twitchId !== null,
    kick: kickId !== null,
    twitch: twitchId !== null,
    sessions: { kick: kickId, twitch: twitchId },
    day: andorraDay(now),
  };
}
