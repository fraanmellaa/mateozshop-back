import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk, gameErrorResponse } from "@/app/utils/games/http";
import { UserEconomy, getUserEconomy } from "@/app/utils/economy/user";
import { getLivePlatforms } from "@/app/utils/live/status";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  const { user } = auth;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("adult_confirmed_at, twitch_id, twitch_username")
      .eq("id", user.id)
      .limit(1);
    if (error) throw error;
    const extra = data?.[0];

    // La economía es información de ayuda: si falla, la extensión sigue funcionando.
    let economy: Partial<UserEconomy> = {};
    try {
      economy = await getUserEconomy(user.id);
    } catch (economyError) {
      console.error("Extension me: economy unavailable:", economyError);
    }

    // Directo real en cada plataforma (con caché); nunca lanza.
    const platforms = await getLivePlatforms().catch(() => null);

    return extensionOk({
      web: {
        id: user.id,
        name: user.username,
        avatar: user.image,
        points: user.points,
        isBanned: user.is_banned,
        adultConfirmed: Boolean(extra?.adult_confirmed_at),
      },
      discord: {
        id: user.discord_id,
        name: user.username,
        avatar: user.image,
      },
      kick: {
        linked: Boolean(user.kick_id),
        name: user.kick_username,
      },
      twitch: {
        linked: Boolean(extra?.twitch_id),
        name: extra?.twitch_username ?? null,
      },
      streak: {
        current: economy.streak?.current ?? 0,
        best: economy.streak?.best ?? 0,
        multiplierPct: economy.watch?.multiplierPct ?? 0,
        minutesToday: economy.streak?.minutesToday ?? 0,
        qualifiedToday: Boolean(economy.streak?.qualifiedToday),
        minutesNeeded: economy.streak?.minutesNeeded ?? 0,
        // Cobro de racha del último día de directo y próximo cobro (día y puntos).
        collected: economy.streak?.collected ?? null,
        next: economy.streak?.next ?? null,
      },
      live: {
        kick: Boolean(platforms?.kick || economy.watch?.live?.kick),
        twitch: Boolean(platforms?.twitch || economy.watch?.live?.twitch),
      },
      // Caja diaria: mismo estado que ve la web (solo lectura).
      boxes: {
        daily: {
          available: Boolean(economy.dailyBox?.available),
          claimedToday: Boolean(economy.dailyBox?.claimedToday),
          minutesNeeded: economy.dailyBox?.minutesNeeded ?? 0,
          minutesToday: economy.dailyBox?.minutesToday ?? 0,
          tiers: economy.dailyBox?.tiers ?? [],
        },
      },
    });
  } catch (error) {
    return gameErrorResponse(error, "extension");
  }
}
