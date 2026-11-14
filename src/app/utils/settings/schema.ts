import { z } from "zod";

/**
 * Esquema y valores por defecto de los ajustes de la extensión. Módulo puro
 * (sin BD ni `crypto`): lo usan el servidor y el formulario del panel.
 *
 * Las validaciones impiden guardar una configuración en la que un juego
 * devuelva de media más de lo apostado.
 */

const bet = z.number().int().min(1).max(1_000_000);
const betRange = (v: { minBet: number; maxBet: number }) => v.minBet <= v.maxBet;
const betRangeError = {
  message: "La apuesta mínima no puede superar la máxima",
  path: ["minBet"],
};

/** Retorno esperado del Plinko: Σ(peso × multiplicador) / Σ pesos. */
export function plinkoRtp(multipliers: number[], weights: number[]): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    total += weights[i];
    sum += weights[i] * (multipliers[i] ?? 0);
  }
  return total > 0 ? sum / total : 0;
}

const watchSchema = z.object({
  intervalSeconds: z.number().int().min(15).max(86_400),
  pointsPerInterval: z.number().int().min(1).max(100_000),
  requireLive: z.boolean(),
  dailyCap: z.number().int().min(1).max(100_000_000).nullable(),
});

const minesSchema = z
  .object({
    minBet: bet,
    maxBet: bet,
    boardSizes: z.array(z.number().int().min(2).max(12)).min(1).max(6),
    maxMinePercent: z.number().min(0.05).max(0.95),
    // Tope 0.99 y no 1: el multiplicador se redondea a 2 decimales, lo que
    // puede subir el retorno hasta medio punto por encima de houseEdge.
    houseEdge: z.number().min(0.5).max(0.99),
    maxMultiplier: z.number().min(1.01).max(1000),
  })
  .refine(betRange, betRangeError)
  .refine((v) => new Set(v.boardSizes).size === v.boardSizes.length, {
    message: "Hay tamaños de tablero repetidos",
    path: ["boardSizes"],
  })
  .refine(
    (v) => v.boardSizes.every((size) => Math.floor(size * size * v.maxMinePercent) >= 1),
    {
      message: "Con ese porcentaje algún tablero no admite ninguna mina",
      path: ["maxMinePercent"],
    }
  );

const crashSchema = z
  .object({
    minBet: bet,
    maxBet: bet,
    houseEdge: z.number().min(0.5).max(1),
    maxMultiplier: z.number().min(1.1).max(1000),
    growthPerTick: z.number().min(1.001).max(1.5),
    tickMs: z.number().int().min(20).max(2000),
  })
  .refine(betRange, betRangeError);

const plinkoSchema = z
  .object({
    minBet: bet,
    maxBet: bet,
    multipliers: z.array(z.number().min(0).max(1000)).min(2).max(15),
    weights: z.array(z.number().int().min(0).max(1_000_000)).min(2).max(15),
  })
  .refine(betRange, betRangeError)
  .refine((v) => v.multipliers.length === v.weights.length, {
    message: "Tiene que haber un peso por cada multiplicador",
    path: ["weights"],
  })
  .refine((v) => v.weights.some((w) => w > 0), {
    message: "Algún peso tiene que ser mayor que 0",
    path: ["weights"],
  })
  .refine(
    (v) =>
      v.multipliers.length !== v.weights.length ||
      plinkoRtp(v.multipliers, v.weights) <= 1 + 1e-9,
    {
      message: "El retorno esperado del Plinko supera el 100 %: regalaría puntos",
      path: ["multipliers"],
    }
  );

export const extensionSettingsSchema = z.object({
  watch: watchSchema,
  mines: minesSchema,
  crash: crashSchema,
  plinko: plinkoSchema,
});

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  watch: {
    intervalSeconds: 300,
    pointsPerInterval: 10,
    requireLive: true,
    dailyCap: null,
  },
  mines: {
    minBet: 10,
    maxBet: 500,
    boardSizes: [4, 8, 10],
    maxMinePercent: 0.75,
    houseEdge: 0.97,
    maxMultiplier: 50,
  },
  crash: {
    minBet: 10,
    maxBet: 500,
    houseEdge: 0.97,
    maxMultiplier: 40,
    growthPerTick: 1.035,
    tickMs: 120,
  },
  plinko: {
    minBet: 10,
    maxBet: 500,
    multipliers: [0.2, 0.6, 1.0, 1.4, 2.0, 3.5],
    weights: [23, 25, 25, 15, 8, 4], // retorno esperado 95,6 %
  },
};

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
