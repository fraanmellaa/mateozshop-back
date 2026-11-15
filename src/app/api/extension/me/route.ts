import { NextRequest } from "next/server";

import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk, gameErrorResponse } from "@/app/utils/games/http";
import { UserEconomy, getUserEconomy } from "@/app/utils/economy/user";
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
        multiplierPct: economy.watch?.multiplierPct ?? 0,
        minutesToday: economy.streak?.minutesToday ?? 0,
        qualifiedToday: Boolean(economy.streak?.qualifiedToday),
      },
      live: {
        kick: Boolean(economy.watch?.live?.kick),
        twitch: Boolean(economy.watch?.live?.twitch),
      },
    });
  } catch (error) {
    return gameErrorResponse(error, "extension");
  }
}
