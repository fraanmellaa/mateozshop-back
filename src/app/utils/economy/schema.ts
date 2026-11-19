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

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const label = z.string().trim().min(1, "Obligatorio").max(40);

// La caja diaria solo da puntos (economía final, nov 2026): un tramo es una
// cantidad de puntos (o un rango) con su probabilidad.
const dailyTier = z
  .object({
    id: z.string().trim().min(1).max(20),
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
    // Puntos de racha: cada día de directo que se llega a `minutes.streak` se
    // cobra `dailyFirst` el día 1 y `dailyStep` más cada día, hasta `dailyMax`.
    // Cada `weeklyEveryDays` días seguidos se cobra además `weeklyPoints`.
    streak: z.object({
      dailyFirst: int(0, MAX_POINTS),
      dailyStep: int(0, MAX_POINTS),
      dailyMax: int(0, MAX_POINTS),
      /** 0 = sin extra semanal. */
      weeklyEveryDays: int(0, 365),
      weeklyPoints: int(0, MAX_POINTS),
    }),
    dailyBox: z.object({
      tiers: z.array(dailyTier).min(1).max(8),
    }),
    // Eventos del directo: !lluvia, !bigwin y !maxwin.
    rain: z.object({
      lluvia: rainKind,
      bigwin: rainKind,
      maxwin: rainKind,
    }),
    tiktok: z.object({
      /** Premio mensual del ranking de TikTok: puntos del 1.º, 2.º y 3.º. */
      monthlyPrizes: z.tuple([int(0, MAX_POINTS), int(0, MAX_POINTS), int(0, MAX_POINTS)]),
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
        message: `Las probabilidades de la caja diaria suman ${total / 100} % y tienen que sumar 100 %`,
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
export type ScaleStep = EconomySettings["leaderboard"]["scale"][number];
export const RAIN_KINDS = ["lluvia", "bigwin", "maxwin"] as const;
export type RainKind = (typeof RAIN_KINDS)[number];

export const DEFAULT_ECONOMY_SETTINGS: EconomySettings = {
  watch: { pointsPerMinute: 10, chatWindowMinutes: 15 },
  antiFarm: {
    minLength: 3,
    minDistinctChars: 2,
    repeatWindowSeconds: 60,
    minGapSeconds: 15,
  },
  minutes: { streak: 20, dailyBox: 15 },
  streak: { dailyFirst: 50, dailyStep: 50, dailyMax: 300, weeklyEveryDays: 7, weeklyPoints: 1000 },
  dailyBox: {
    // 50 % · 30 % · 15 % · 4 % · 1 %. Las probabilidades no se publican.
    tiers: [
      { id: "p50", label: "50 puntos", weight: 5000, kind: "points", pointsMin: 50, pointsMax: 50 },
      { id: "p100", label: "100 puntos", weight: 3000, kind: "points", pointsMin: 100, pointsMax: 100 },
      { id: "p250", label: "250 puntos", weight: 1500, kind: "points", pointsMin: 250, pointsMax: 250 },
      { id: "p500", label: "500 puntos", weight: 400, kind: "points", pointsMin: 500, pointsMax: 500 },
      { id: "p2500", label: "2.500 puntos", weight: 100, kind: "points", pointsMin: 2500, pointsMax: 2500 },
    ],
  },
  rain: {
    lluvia: { points: 150, windowMinutes: 10, maxPerStream: 3 },
    bigwin: { points: 300, windowMinutes: 10, maxPerStream: 2 },
    maxwin: { points: 1000, windowMinutes: 10, maxPerStream: 1 },
  },
  tiktok: { monthlyPrizes: [5000, 3000, 2000] },
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

/** Puntos de racha que se cobran el día `day` de racha (1 = primer día). */
export function streakDayPoints(streak: EconomySettings["streak"], day: number): number {
  if (day < 1) return 0;
  return Math.min(streak.dailyFirst + (day - 1) * streak.dailyStep, streak.dailyMax);
}

/** Extra que se cobra además el día `day` de racha (cada `weeklyEveryDays` días seguidos), o 0. */
export function streakWeeklyBonus(streak: EconomySettings["streak"], day: number): number {
  if (day < 1 || streak.weeklyEveryDays < 1) return 0;
  return day % streak.weeklyEveryDays === 0 ? streak.weeklyPoints : 0;
}
