import { getShopSettings } from "./settings";

/**
 * Reglas públicas de la tienda para las bases legales. Sin secretos; las cifras
 * salen de los ajustes vigentes.
 */
export async function getPublicShopRules(): Promise<Record<string, unknown>> {
  const s = await getShopSettings();

  return {
    model: "Todos los premios se consiguen por pujas con puntos.",
    bidding: {
      battleMinutes: s.battleMinutes,
      extendWindowMinutes: s.extendWindowMinutes,
      extendMinutes: s.extendMinutes,
      minIncrementPct: s.minIncrementPct,
      minIncrementPoints: 1,
      waitsForFirstBid: true,
      winner: "highest_bid",
      holdsPoints: true,
      refundsWhenOutbid: "instant",
      nextUnitWhenStock: true,
    },
    limits: {
      maxWinsPerMonth: s.maxWinsPerMonth,
      monthTimezone: "Europe/Andorra",
      minAccountAgeDays: s.minAccountAgeDays,
      requiresAdult: true,
      requiresLinkedAccount: "kick_or_twitch",
    },
    delivery: {
      digitalOnly: true,
      code: "El código se envía por email o mensaje privado.",
      skins: "Las skins se entregan por enlace de intercambio de Steam.",
    },
    review: {
      thresholdEur: s.reviewThresholdEur,
      manualReviewAbove: true,
    },
  };
}
