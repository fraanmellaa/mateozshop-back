import { getEconomySettings } from "./settings";

/** Reglas públicas de la economía para las bases legales (sin secretos). */
export async function getPublicEconomyRules(): Promise<Record<string, unknown>> {
  const s = await getEconomySettings();

  const dailyTotal = s.dailyBox.tiers.reduce((sum, t) => sum + t.weight, 0);
  const streakTotal = s.streak.boxTiers.reduce((sum, t) => sum + t.weight, 0);

  return {
    pointsPerMinute: s.watch.pointsPerMinute,
    chatWindowMinutes: s.watch.chatWindowMinutes,
    pointValueEur: s.pointValueEur ?? null,
    antiFarm: {
      minLength: s.antiFarm.minLength,
      minDistinctChars: s.antiFarm.minDistinctChars,
      repeatWindowSeconds: s.antiFarm.repeatWindowSeconds,
      minGapSeconds: s.antiFarm.minGapSeconds,
    },
    streak: {
      minutesPerDay: s.minutes.streak,
      bonusFromDay: s.streak.bonusFromDay,
      bonusPct: s.streak.bonusPct,
      boxEveryDays: s.streak.boxEveryDays,
      resetsMonthly: false,
      boxTiers: s.streak.boxTiers.map((t) => ({
        points: t.points,
        probabilityPct: (t.weight / streakTotal) * 100,
      })),
    },
    dailyBox: {
      minutesNeeded: s.minutes.dailyBox,
      perLiveDay: 1,
      tiers: s.dailyBox.tiers.map((t) => ({
        id: t.id,
        label: t.label,
        probabilityPct: (t.weight / dailyTotal) * 100,
        ...(t.kind === "points"
          ? { kind: "points", pointsMin: t.pointsMin, pointsMax: t.pointsMax }
          : {
              kind: "item",
              name: t.name,
              monthlyStock: t.monthlyStock,
              fallbackPoints: t.fallbackPoints,
            }),
      })),
    },
    rain: {
      lluvia: { ...s.rain.lluvia },
      maxwin: { ...s.rain.maxwin },
    },
    leaderboard: {
      countsOnly: ["watch", "rain"],
      scale: s.leaderboard.scale.map((x) => ({ ...x })),
      bonusDoesNotStack: true,
    },
    monthlyReset: {
      enabled: s.monthlyReset.enabled,
      timezone: "Europe/Andorra",
      balancesToZero: true,
      closesAuctionsAndGiveaways: true,
    },
  };
}
