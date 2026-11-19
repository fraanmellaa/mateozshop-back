import { z } from "zod";

/**
 * Predicciones (Classic): dos opciones, se juegan puntos normales y el bote se
 * reparte entre los que aciertan (migración 0042). Módulo puro: lo usan el
 * servidor y el panel. No confundir con `utils/streamPredictions` (voto gratis,
 * un ganador) ni con `utils/predictions` (los Pronósticos deportivos).
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const CLASSIC_LOCK_MODES = ["manual", "timer", "stream"] as const;
export type ClassicLockMode = (typeof CLASSIC_LOCK_MODES)[number];
export type ClassicSide = "a" | "b";

export const CLASSIC_DEFAULT_MIN_BET = 10;
export const CLASSIC_DEFAULT_MAX_BET = 100_000;
export const CLASSIC_MAX_BET_LIMIT = 100_000_000;
/** Duración de la votación con temporizador, en segundos. */
export const CLASSIC_TIMER_MIN_SECONDS = 10;
export const CLASSIC_TIMER_MAX_SECONDS = 86_400;

const texts = {
  title: z.string().trim().min(3, "La pregunta es demasiado corta").max(200),
  optionA: z.string().trim().min(1, "Falta la primera opción").max(40),
  optionB: z.string().trim().min(1, "Falta la segunda opción").max(40),
  minBet: int(1, CLASSIC_MAX_BET_LIMIT),
  maxBet: int(1, CLASSIC_MAX_BET_LIMIT),
};

type Texts = { optionA: string; optionB: string; minBet: number; maxBet: number };
const checkTexts = (value: Texts, ctx: z.RefinementCtx) => {
  if (value.optionA.toLowerCase() === value.optionB.toLowerCase()) {
    ctx.addIssue({ code: "custom", message: "Las dos opciones no pueden ser iguales", path: ["optionB"] });
  }
  if (value.maxBet < value.minBet) {
    ctx.addIssue({ code: "custom", message: "El máximo no puede ser menor que el mínimo", path: ["maxBet"] });
  }
};

/** Abrir una predicción a mano desde el panel. */
export const createClassicPredictionSchema = z
  .object({
    ...texts,
    /** manual: la cierras tú · timer: se cierra sola a los `seconds` · stream: al acabar el directo. */
    lockMode: z.enum(CLASSIC_LOCK_MODES),
    seconds: int(CLASSIC_TIMER_MIN_SECONDS, CLASSIC_TIMER_MAX_SECONDS).optional(),
  })
  .superRefine((value, ctx) => {
    checkTexts(value, ctx);
    if (value.lockMode === "timer" && value.seconds === undefined) {
      ctx.addIssue({ code: "custom", message: "Indica cuánto dura la votación", path: ["seconds"] });
    }
  });
export type CreateClassicPredictionInput = z.infer<typeof createClassicPredictionSchema>;

/** Plantilla: predicción de serie que se abre sola en cada directo. */
export const classicTemplateSchema = z
  .object({
    ...texts,
    isActive: z.boolean(),
    sortOrder: int(0, 1000).optional(),
  })
  .superRefine(checkTexts);
export type ClassicTemplateInput = z.infer<typeof classicTemplateSchema>;

export const classicAdminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lock") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resolve"), winner: z.enum(["a", "b"]) }),
]);

/** Jugada desde la extensión. `requestId` hace que repetir la petición no cobre dos veces. */
export const classicBetSchema = z.object({
  predictionId: int(1, Number.MAX_SAFE_INTEGER),
  side: z.enum(["a", "b"]),
  amount: int(1, CLASSIC_MAX_BET_LIMIT),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
