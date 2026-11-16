import { z } from "zod";

import { OUTER_LEN, PLINKO_LEVEL_IDS, type PlinkoLevelId, buildTable, rtpOf } from "../games/table";

/**
 * Esquema y valores por defecto de los ajustes de juegos (clave `games` de
 * `app_settings`). Módulo puro (sin BD ni `crypto`): lo usan el servidor y el
 * panel. Las validaciones impiden guardar una configuración que regale puntos:
 * todo RTP está en (0, 0.99] y el RTP real de cada tabla construida también.
 */

export const MAX_RTP = 0.99;
const RTP_EPS = 1e-9;
/** Pago máximo posible en una petición: tiene que caber en un integer de Postgres. */
const MAX_PAYOUT_PER_REQUEST = 1_500_000_000;

const bet = z.number().int().min(1).max(1_000_000);
const rtp = z
  .number()
  .refine((v) => v > 0 && v <= MAX_RTP, "El RTP tiene que estar entre 0 (sin incluir) y 0.99");
const betRangeError = (path: string) => ({
  message: "La apuesta mínima no puede superar la máxima",
  path: [path],
});

const crashSchema = z
  .object({
    rtp,
    maxMult: z.number().min(1.01).max(100_000),
    minBet: bet,
    maxBet: bet,
  })
  .refine((v) => v.minBet <= v.maxBet, betRangeError("minBet"))
  .refine((v) => v.maxBet * v.maxMult <= MAX_PAYOUT_PER_REQUEST, {
    message: "Apuesta máxima × multiplicador máximo es demasiado grande",
    path: ["maxMult"],
  });

// Buscaminas: la tabla sale de RTP × C(25,k)/C(25−m,k) truncado hacia abajo, así
// que con RTP ≤ 0.99 ninguna combinación de minas y parada devuelve más.
const minesSchema = z
  .object({
    rtp,
    maxMult: z.number().min(1.01).max(100_000),
    minBet: bet,
    maxBet: bet,
  })
  .refine((v) => v.minBet <= v.maxBet, betRangeError("minBet"))
  .refine((v) => v.maxBet * v.maxMult <= MAX_PAYOUT_PER_REQUEST, {
    message: "Apuesta máxima × multiplicador máximo es demasiado grande",
    path: ["maxMult"],
  });

const levelSchema = z.object({
  outer: z
    .array(z.number().min(0).max(100_000))
    .refine((a) => a.length === OUTER_LEN, `Hacen falta ${OUTER_LEN} multiplicadores de borde`),
  rtp,
  maxBet: bet.optional(),
});

const plinkoSchema = z
  .object({
    minBet: bet,
    maxBet: bet,
    maxBalls: z.number().int().min(1).max(100),
    levels: z.object({
      facil: levelSchema,
      medio: levelSchema,
      hard: levelSchema,
      extreme: levelSchema,
    }),
  })
  .refine((v) => v.minBet <= v.maxBet, betRangeError("minBet"))
  .superRefine((v, ctx) => {
    for (const id of PLINKO_LEVEL_IDS) {
      const level = v.levels[id];
      const maxBet = effectiveMaxBet(v, id);
      if (v.minBet > maxBet) {
        ctx.addIssue({
          code: "custom",
          message: "La apuesta mínima supera la máxima de este nivel",
          path: ["levels", id, "maxBet"],
        });
      }
      const table = buildTable(level.outer, level.rtp);
      const real = rtpOf(table);
      if (real > MAX_RTP + RTP_EPS || real > level.rtp + RTP_EPS) {
        ctx.addIssue({
          code: "custom",
          message: `Con esos multiplicadores de borde el RTP real sería ${(real * 100).toFixed(2)} %, por encima del objetivo (${(level.rtp * 100).toFixed(1)} %). Baja los bordes`,
          path: ["levels", id, "outer"],
        });
      }
      const top = Math.max(...table);
      if (maxBet * top * v.maxBalls > MAX_PAYOUT_PER_REQUEST) {
        ctx.addIssue({
          code: "custom",
          message: "Apuesta máxima × multiplicador máximo × bolas es demasiado grande",
          path: ["levels", id, "outer"],
        });
      }
    }
  });

const tournamentSchema = z.object({
  level: z.enum(PLINKO_LEVEL_IDS),
  spinsPerEntry: z.number().int().min(1).max(10_000),
  chipsPerSpin: z.number().int().min(1).max(1_000_000),
});

// Sin tope diario: un `dailyWagerCap` antiguo guardado en `app_settings` se
// ignora al leer (z.object descarta las claves que no conoce).
export const gamesSettingsSchema = z.object({
  crash: crashSchema,
  plinko: plinkoSchema,
  mines: minesSchema,
  tournament: tournamentSchema,
});

export type GamesSettings = z.infer<typeof gamesSettingsSchema>;

export const DEFAULT_GAMES_SETTINGS: GamesSettings = {
  crash: { rtp: 0.9, maxMult: 1000, minBet: 10, maxBet: 2000 },
  plinko: {
    minBet: 10,
    maxBet: 1000,
    maxBalls: 100,
    levels: {
      facil: { outer: [16, 9, 2, 1.4, 1.4, 1.2], rtp: 0.92 },
      medio: { outer: [110, 41, 10, 5, 3, 1.5], rtp: 0.9 },
      hard: { outer: [1000, 130, 26, 9, 4, 1.5], rtp: 0.88 },
      extreme: { outer: [10000, 250, 25, 5, 1, 0.5], rtp: 0.8, maxBet: 100 },
    },
  },
  mines: { rtp: 0.9, maxMult: 1000, minBet: 10, maxBet: 1000 },
  tournament: { level: "medio", spinsPerEntry: 1000, chipsPerSpin: 100 },
};

/** Apuesta máxima efectiva de un nivel: la menor entre la general y la del nivel. */
export function effectiveMaxBet(
  plinko: { maxBet: number; levels: Record<PlinkoLevelId, { maxBet?: number }> },
  level: PlinkoLevelId
): number {
  return Math.min(plinko.maxBet, plinko.levels[level].maxBet ?? plinko.maxBet);
}

/** Tabla de 17 multiplicadores y RTP real de un nivel. */
export function plinkoTable(settings: GamesSettings, level: PlinkoLevelId) {
  const l = settings.plinko.levels[level];
  const table = buildTable(l.outer, l.rtp);
  return { table, rtp: rtpOf(table) };
}

export type SettingsIssue = { path: string; message: string };

// Los mensajes propios ya están en español; los genéricos de zod se traducen.
function issueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_small":
      return `El mínimo es ${issue.minimum}`;
    case "too_big":
      return `El máximo es ${issue.maximum}`;
    case "invalid_type":
      return "Falta el valor o no es un número";
    case "custom":
      return issue.message;
    default:
      return "Valor no válido";
  }
}

export function settingsIssues(error: z.ZodError): SettingsIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issueMessage(issue),
  }));
}
