import { getLiveStatus as getKickLive } from "@/app/utils/kick/live";
import { fetchTwitchLive } from "@/app/utils/twitch/helix";

export type LivePlatforms = { live: boolean; kick: boolean; twitch: boolean };

const TTL_MS = 60_000;
// Si Twitch falla no se reintenta en cada petición.
const ERROR_TTL_MS = 15_000;

let twitchCache: { live: boolean; expiresAt: number } | null = null;
let twitchInFlight: Promise<boolean> | null = null;

const twitchConfigured = () =>
  ["TWITCH_BROADCASTER_ID", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"].every(
    (name) => Boolean(process.env[name])
  );
const kickConfigured = () =>
  ["KICK_BROADCASTER_USER_ID", "NEXT_PUBLIC_KICK_CLIENT_ID", "KICK_CLIENT_SECRET"].every(
    (name) => Boolean(process.env[name])
  );

/** Directo en Twitch con caché de ~60 s; sin credenciales o con error, el último valor o `false`. */
async function getTwitchLive(): Promise<boolean> {
  if (!twitchConfigured()) return false;
  if (twitchCache && Date.now() < twitchCache.expiresAt) return twitchCache.live;

  if (!twitchInFlight) {
    twitchInFlight = fetchTwitchLive()
      .then((live) => {
        twitchCache = { live, expiresAt: Date.now() + TTL_MS };
        return live;
      })
      .catch((error) => {
        console.error("Error fetching Twitch live status:", error);
        const live = twitchCache?.live ?? false;
        twitchCache = { live, expiresAt: Date.now() + ERROR_TTL_MS };
        return live;
      })
      .finally(() => {
        twitchInFlight = null;
      });
  }
  return twitchInFlight;
}

/** Estado del directo en cada plataforma, para pintarlo en la web (solo lectura, no toca sesiones). */
export async function getLivePlatforms(): Promise<LivePlatforms> {
  const [kick, twitch] = await Promise.all([
    kickConfigured() ? getKickLive().catch(() => false) : Promise.resolve(false),
    getTwitchLive().catch(() => false),
  ]);
  return { live: kick || twitch, kick, twitch };
}
