import { NextResponse } from "next/server";

import { getPublicEconomyRules } from "@/app/utils/economy/rules";
import { getPublicGamesRules } from "@/app/utils/games/rules";
import { getPublicGiveawayRules } from "@/app/utils/giveaways/rules";
import { getLootBoxOdds } from "@/app/utils/lootBoxes";
import { getPublicShopRules } from "@/app/utils/shop/rules";

/** Cada bloque va protegido: si uno falla, ese bloque es null y los demás siguen. */
async function safe<T>(name: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`Error loading legal rules block "${name}":`, error);
    return null;
  }
}

export async function GET() {
  const [economy, shop, games, boxes, giveaways] = await Promise.all([
    safe("economy", () => getPublicEconomyRules()),
    safe("shop", () => getPublicShopRules()),
    safe("games", () => getPublicGamesRules()),
    safe("boxes", () => getLootBoxOdds()),
    safe("giveaways", () => getPublicGiveawayRules()),
  ]);

  return NextResponse.json({
    success: true,
    data: { economy, shop, games, boxes, giveaways },
  });
}
