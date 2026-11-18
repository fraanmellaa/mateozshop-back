import { z } from "zod";

/**
 * Esquema y valores por defecto de los ajustes `economy`. Módulo puro (sin BD
 * ni `crypto`): lo usan el servidor y el formulario del panel.
 *
 * Todas las cifras tienen un máximo: la configuración no puede regalar puntos
 * sin límite ni dejar valores negativos o absurdos.
 */

const MAX_POINTS = 1_000_000;

/** Cajas: los pesos de la caja diaria se expresan en puntos básicos (suman 10.000). */
export const DAILY_BOX_TOTAL_WEIGHT = 10_000;
export const DAILY_TIER_IDS = ["common", "rare", "epic", "legendary"] as const;
export type DailyTierId = (typeof DAILY_TIER_IDS)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const label = z.string().trim().min(1, "Obligatorio").max(40);

const dailyPointsTier = z
  .object({
    id: z.enum(DAILY_TIER_IDS),
    label,
    /** Puntos básicos sobre 10.000. */
    weight: int(0, DAILY_BOX_TOTAL_WEIGHT),
    kind: z.literal("points"),
    pointsMin: int(1, MAX_POINTS),
    pointsMax: int(1, MAX_POINTS),
  })
  .refine((t) => t.pointsMin <= t.pointsMax, {
    message: "El mínimo no puede superar el máximo",
    path: ["pointsMin"],
  });

const dailyItemTier = z.object({
  id: z.enum(DAILY_TIER_IDS),
  label,
  weight: int(0, DAILY_BOX_TOTAL_WEIGHT),
  kind: z.literal("item"),
  name: z.string().trim().min(1, "Obligatorio").max(80),
  /** Unidades que se pueden entregar cada mes. 0 = siempre puntos de respaldo. */
  monthlyStock: int(0, 1000),
  /** Puntos que se dan si el objeto se ha agotado. */
  fallbackPoints: int(1, MAX_POINTS),
});

const dailyTier = z.discriminatedUnion("kind", [dailyPointsTier, dailyItemTier]);

const streakTier = z.object({
  points: int(1, MAX_POINTS),
  /** Peso relativo (60/30/9/1 = porcentajes). */
  weight: int(1, 10_000),
});

const rainKind = z.object({
  points: int(0, 100_000),
  windowMinutes: int(1, 120),
  /** Máximo por directo. 0 = desactivada. */
  maxPerStream: int(0, 20),
});

const scaleStep = z
  .object({
    from: int(1, 50),
    to: int(1, 50),
    points: int(0, MAX_POINTS),
    multiplierPct: int(0, 100),
  })
  .refine((s) => s.from <= s.to, {
    message: "«Desde» no puede superar «hasta»",
    path: ["from"],
  });

export const economySettingsSchema = z
  .object({
    watch: z.object({
      pointsPerMinute: int(1, 1000),
      chatWindowMinutes: int(1, 120),
    }),
    antiFarm: z.object({
      /** Caracteres mínimos del mensaje. */
      minLength: int(1, 50),
      /** Letras o números distintos como mínimo. */
      minDistinctChars: int(1, 20),
      /** Un mismo texto no cuenta dos veces dentro de esta ventana. */
      repeatWindowSeconds: int(0, 3600),
      /** Como mucho un mensaje cuenta cada N segundos. */
      minGapSeconds: int(0, 3600),
    }),
    minutes: z.object({
      streak: int(1, 240),
      dailyBox: int(1, 240),
    }),
    streak: z.object({
      bonusFromDay: int(1, 365),
      bonusPct: int(0, 100),
      boxEveryDays: int(1, 365),
      boxTiers: z.array(streakTier).min(1).max(8),
    }),
    dailyBox: z.object({
      tiers: z.array(dailyTier).min(1).max(4),
    }),
    rain: z.object({
      lluvia: rainKind,
      maxwin: rainKind,
    }),
    leaderboard: z.object({
      scale: z.array(scaleStep).min(1).max(10),
    }),
    /** Informativo (se muestra en las bases legales). */
    pointValueEur: z.number().min(0).max(1000).optional(),
    monthlyReset: z.object({ enabled: z.boolean() }),
  })
  .superRefine((v, ctx) => {
    // Caja diaria: los pesos suman exactamente 10.000 y los id no se repiten.
    const total = v.dailyBox.tiers.reduce((sum, t) => sum + t.weight, 0);
    if (total !== DAILY_BOX_TOTAL_WEIGHT) {
      ctx.addIssue({
        code: "custom",
        message: `Los pesos de la caja diaria suman ${total} y tienen que sumar ${DAILY_BOX_TOTAL_WEIGHT}`,
        path: ["dailyBox", "tiers"],
      });
    }
    const ids = v.dailyBox.tiers.map((t) => t.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Hay tramos repetidos en la caja diaria",
        path: ["dailyBox", "tiers"],
      });
    }

    // Escala del leaderboard: sin solapes.
    const steps = [...v.leaderboard.scale].sort((a, b) => a.from - b.from);
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].from <= steps[i - 1].to) {
        ctx.addIssue({
          code: "custom",
          message: "Los tramos del leaderboard se solapan",
          path: ["leaderboard", "scale"],
        });
        break;
      }
    }
  });

export type EconomySettings = z.infer<typeof economySettingsSchema>;
export type DailyTier = EconomySettings["dailyBox"]["tiers"][number];
export type StreakTier = EconomySettings["streak"]["boxTiers"][number];
export type ScaleStep = EconomySettings["leaderboard"]["scale"][number];
export type RainKind = "lluvia" | "maxwin";

export const DEFAULT_ECONOMY_SETTINGS: EconomySettings = {
  watch: { pointsPerMinute: 10, chatWindowMinutes: 15 },
  antiFarm: {
    minLength: 3,
    minDistinctChars: 2,
    repeatWindowSeconds: 60,
    minGapSeconds: 15,
  },
  minutes: { streak: 20, dailyBox: 15 },
  streak: {
    bonusFromDay: 7,
    bonusPct: 10,
    boxEveryDays: 7,
    boxTiers: [
      { points: 1000, weight: 60 },
      { points: 3000, weight: 30 },
      { points: 6000, weight: 9 },
      { points: 10000, weight: 1 },
    ],
  },
  dailyBox: {
    tiers: [
      { id: "common", label: "Común", weight: 7500, kind: "points", pointsMin: 50, pointsMax: 100 },
      { id: "rare", label: "Raro", weight: 2000, kind: "points", pointsMin: 200, pointsMax: 300 },
      { id: "epic", label: "Épico", weight: 490, kind: "points", pointsMin: 1000, pointsMax: 1000 },
      {
        id: "legendary",
        label: "Legendario",
        weight: 10,
        kind: "item",
        name: "Tarjeta de 10 €",
        monthlyStock: 3,
        fallbackPoints: 1000,
      },
    ],
  },
  rain: {
    lluvia: { points: 300, windowMinutes: 10, maxPerStream: 3 },
    maxwin: { points: 1000, windowMinutes: 10, maxPerStream: 2 },
  },
  leaderboard: {
    // Bonus de puntos al empezar el mes siguiente. Sin multiplicador «% por
    // ver» (multiplierPct a 0) y sin premio del puesto 11 en adelante.
    scale: [
      { from: 1, to: 1, points: 10000, multiplierPct: 0 },
      { from: 2, to: 3, points: 6000, multiplierPct: 0 },
      { from: 4, to: 10, points: 3000, multiplierPct: 0 },
    ],
  },
  monthlyReset: { enabled: true },
};

export type EconomyIssue = { path: string; message: string };

function issueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_small":
      return `El mínimo es ${issue.minimum}`;
    case "too_big":
      return `El máximo es ${issue.maximum}`;
    case "invalid_type":
    case "invalid_union":
      return "Falta el valor o no es válido";
    case "custom":
      return issue.message;
    default:
      return "Valor no válido";
  }
}

export function economyIssues(error: z.ZodError): EconomyIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issueMessage(issue),
  }));
}
