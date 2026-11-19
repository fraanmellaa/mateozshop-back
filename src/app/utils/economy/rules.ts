import { getEconomySettings } from "./settings";

/** Reglas públicas de la economía para las bases legales (sin secretos). */
export async function getPublicEconomyRules(): Promise<Record<string, unknown>> {
  const s = await getEconomySettings();

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
      dailyPoints: { first: s.streak.dailyFirst, step: s.streak.dailyStep, max: s.streak.dailyMax },
      weekly: { everyDays: s.streak.weeklyEveryDays, points: s.streak.weeklyPoints },
      resetsMonthly: false,
    },
    // Solo cuándo se consigue: los premios y sus probabilidades no se publican.
    dailyBox: {
      minutesNeeded: s.minutes.dailyBox,
      perLiveDay: 1,
    },
    rain: {
      lluvia: { ...s.rain.lluvia },
      bigwin: { ...s.rain.bigwin },
      maxwin: { ...s.rain.maxwin },
    },
    leaderboard: {
      countsOnly: ["watch"],
      tieBreak: "streak",
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
