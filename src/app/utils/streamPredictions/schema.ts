import { z } from "zod";

/**
 * Predicciones del directo (no confundir con los Pronósticos deportivos de
 * `utils/predictions`). Módulo puro: lo usan el servidor y el panel.
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Ajustes (`app_settings`, clave `stream_predictions`). */
export const streamPredictionSettingsSchema = z.object({
  /** Puntos que cobra el único ganador de cada predicción. */
  winnerPoints: int(1, 1_000_000),
  /** Predicciones como mucho en un mismo directo. 0 = desactivadas. */
  maxPerStream: int(0, 20),
});

export type StreamPredictionSettings = z.infer<typeof streamPredictionSettingsSchema>;

export const DEFAULT_STREAM_PREDICTION_SETTINGS: StreamPredictionSettings = {
  winnerPoints: 2500,
  maxPerStream: 2,
};

export const STREAM_PREDICTION_KINDS = ["options", "number"] as const;
export type StreamPredictionKind = (typeof STREAM_PREDICTION_KINDS)[number];

export const MAX_OPTIONS = 6;
const NUMBER_LIMIT = 999_999_999;

/** Un número con dos decimales como mucho, dentro de un rango razonable. */
const predictionNumber = z
  .number()
  .min(-NUMBER_LIMIT)
  .max(NUMBER_LIMIT)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "Como mucho dos decimales",
  });

export const createStreamPredictionSchema = z
  .object({
    question: z.string().trim().min(3, "La pregunta es demasiado corta").max(200),
    kind: z.enum(STREAM_PREDICTION_KINDS),
    options: z.array(z.string().trim().min(1).max(60)).max(MAX_OPTIONS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "options") return;
    const options = value.options ?? [];
    if (options.length < 2) {
      ctx.addIssue({ code: "custom", message: "Pon al menos dos opciones", path: ["options"] });
    }
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      ctx.addIssue({ code: "custom", message: "Hay opciones repetidas", path: ["options"] });
    }
  });

export type CreateStreamPredictionInput = z.infer<typeof createStreamPredictionSchema>;

/** Voto o resultado: una opción (por su posición) o un número, nunca los dos. */
const answerFields = {
  option: int(0, MAX_OPTIONS - 1).optional(),
  number: predictionNumber.optional(),
};
const exactlyOne = (value: { option?: number; number?: number }) =>
  (value.option === undefined) !== (value.number === undefined);
const ONE_ANSWER = { message: "Indica una opción o un número" };

export const voteStreamPredictionSchema = z
  .object({ predictionId: int(1, Number.MAX_SAFE_INTEGER), ...answerFields })
  .refine(exactlyOne, ONE_ANSWER);

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resolve"), ...answerFields }).refine(exactlyOne, ONE_ANSWER),
]);

export type Answer = { option?: number; number?: number };
