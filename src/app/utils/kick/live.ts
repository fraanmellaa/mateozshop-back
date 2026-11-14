import { clearAppAccessToken, getAppAccessToken } from "@/app/api/utils";
import { requireEnv } from "@/lib/env";

const LIVE_TTL_MS = 60_000;
// Si Kick falla no se reintenta en cada petición.
const ERROR_TTL_MS = 15_000;

let cache: { live: boolean; expiresAt: number } | null = null;
let inFlight: Promise<boolean> | null = null;

async function fetchLiveStatus(): Promise<boolean> {
  const broadcasterId = requireEnv("KICK_BROADCASTER_USER_ID");
  const token = await getAppAccessToken();

  const res = await fetch(
    `https://api.kick.com/public/v1/channels?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (res.status === 401) clearAppAccessToken();
  if (!res.ok) {
    throw new Error(`Kick channels request failed (${res.status})`);
  }

  const body = await res.json();
  return body?.data?.[0]?.stream?.is_live === true;
}

/**
 * ¿Está el canal en directo? Caché en memoria de ~60 s. Si Kick no responde
 * devuelve el último valor conocido o, si no hay, `false`.
 */
export async function getLiveStatus(): Promise<boolean> {
  if (cache && Date.now() < cache.expiresAt) return cache.live;

  if (!inFlight) {
    inFlight = fetchLiveStatus()
      .then((live) => {
        cache = { live, expiresAt: Date.now() + LIVE_TTL_MS };
        return live;
      })
      .catch((error) => {
        console.error("Error fetching Kick live status:", error);
        const live = cache?.live ?? false;
        cache = { live, expiresAt: Date.now() + ERROR_TTL_MS };
        return live;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}
