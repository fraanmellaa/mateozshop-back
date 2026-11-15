import { createHash } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { updatePlatformUsername } from "@/app/utils/users";

import { getAntiFarmSettings, type AntiFarmSettings } from "./settings";

export type Platform = "kick" | "twitch";

export type ChatMessage = {
  platform: Platform;
  messageId: string;
  chatterId: string;
  chatterName: string;
  text: string;
  isStreamer: boolean; // el emisor es el dueño del canal
  isModerator: boolean; // moderador (insignia del evento)
};

type LinkedUser = {
  id: number;
  is_banned: boolean;
  username: string | null;
};

const USER_CACHE_TTL_MS = 30_000;
const USER_CACHE_MAX = 5000;
// Los no vinculados también se cachean: la mayoría del chat no lo está.
const userCache = new Map<string, { user: LinkedUser | null; expiresAt: number }>();

async function findLinkedUser(platform: Platform, chatterId: string): Promise<LinkedUser | null> {
  const key = `${platform}:${chatterId}`;
  const hit = userCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.user;

  const idColumn = platform === "kick" ? "kick_id" : "twitch_id";
  const nameColumn = platform === "kick" ? "kick_username" : "twitch_username";
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select(`id, is_banned, ${nameColumn}`)
    .eq(idColumn, chatterId)
    .limit(1);
  if (error) throw error;

  const row = data?.[0] as Record<string, unknown> | undefined;
  const user: LinkedUser | null = row
    ? {
        id: Number(row.id),
        is_banned: Boolean(row.is_banned),
        username: typeof row[nameColumn] === "string" ? (row[nameColumn] as string) : null,
      }
    : null;

  if (userCache.size >= USER_CACHE_MAX) userCache.clear();
  userCache.set(key, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return user;
}

/** Contenido mínimo para contar como actividad: longitud y variedad de caracteres. */
export function isMeaningfulText(text: string, rules: AntiFarmSettings): boolean {
  const trimmed = text.trim();
  if (trimmed.length < rules.minLength) return false;
  const distinct = new Set(trimmed.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []);
  return distinct.size >= rules.minDistinctChars;
}

function textHash(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export type ChatOutcome = {
  /** El chatter está vinculado a un usuario. */
  linked: boolean;
  /** El mensaje contó como actividad. */
  counted: boolean;
  /** Comando de lluvia pedido por alguien autorizado. */
  command: "lluvia" | "maxwin" | null;
};

/** Comando exacto: `!lluvia` / `!maxwin` solas (sin distinguir mayúsculas). */
export function parseRainCommand(text: string): "lluvia" | "maxwin" | null {
  const word = text.trim().toLowerCase();
  if (word === "!lluvia") return "lluvia";
  if (word === "!maxwin") return "maxwin";
  return null;
}

/**
 * Procesa un mensaje de chat ya verificado y deduplicado: mapea al usuario
 * vinculado (los no vinculados y los baneados se ignoran), actualiza el nombre
 * guardado si cambió y registra la actividad aplicando el anti-farmeo.
 * Los comandos de lluvia solo se devuelven si el emisor es el streamer o un
 * moderador; los ejecuta quien llama (los emisores no tienen por qué estar
 * vinculados a un usuario de la tienda).
 */
export async function processChatMessage(message: ChatMessage): Promise<ChatOutcome> {
  const authorized = message.isStreamer || message.isModerator;
  const command = authorized ? parseRainCommand(message.text) : null;

  const user = await findLinkedUser(message.platform, message.chatterId);
  if (!user || user.is_banned) return { linked: Boolean(user), counted: false, command };

  if (message.chatterName && user.username !== message.chatterName) {
    try {
      await updatePlatformUsername(user.id, message.platform, message.chatterName);
      user.username = message.chatterName;
    } catch (error) {
      console.error("Error updating platform username:", error);
    }
  }

  // Los comandos no cuentan como actividad.
  if (command || parseRainCommand(message.text)) return { linked: true, counted: false, command };

  const rules = await getAntiFarmSettings();
  const { data, error } = await getSupabaseAdmin().rpc("chat_register_message", {
    p_user_id: user.id,
    p_platform: message.platform,
    p_text_hash: textHash(message.text),
    p_valid: isMeaningfulText(message.text, rules),
    p_now: Math.floor(Date.now() / 1000),
    p_min_gap: rules.minGapSeconds,
    p_repeat_window: rules.repeatWindowSeconds,
  });
  if (error) throw error;

  return { linked: true, counted: data === true, command };
}
