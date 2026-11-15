import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const predictionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000),
  sport: optionalText(60),
  league: optionalText(120),
  pick: optionalText(200),
  odds: z.number().min(1).max(10000).nullish().transform((v) => v ?? null),
  event_at: z.number().int().min(0).max(4102444800).nullish().transform((v) => v ?? null),
  is_published: z.boolean(),
});

export const createPredictionSchema = predictionSchema.partial({
  body: true,
  sport: true,
  league: true,
  pick: true,
  odds: true,
  event_at: true,
  is_published: true,
});

export const updatePredictionSchema = predictionSchema.partial();

export const predictionSettingsSchema = z.object({
  autoPublishTelegram: z.boolean(),
});

export type PredictionSettings = z.infer<typeof predictionSettingsSchema>;
export const DEFAULT_PREDICTION_SETTINGS: PredictionSettings = {
  autoPublishTelegram: false,
};
