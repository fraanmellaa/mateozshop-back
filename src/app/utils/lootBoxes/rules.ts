import { z } from "zod";

import {
  RARITIES,
  RARITY_LABELS,
  WEIGHTS_TOTAL,
  type BoxWeights,
  type PrizeKind,
  type Rarity,
} from "./types";

/**
 * Reglas de negocio de las cajas. Módulo puro (sin BD ni `crypto`): lo usan
 * el servidor (que es quien manda) y el formulario del panel (indicador en
 * vivo).
 */

export type LootBoxErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_WEIGHTS_SUM"
  | "BOX_NEEDS_COMMON_POINTS_PRIZE"
  | "CATEGORY_WITHOUT_PRIZES"
  | "COMMON_PRIZE_MUST_BE_POINTS"
  | "PRIZE_POINTS_REQUIRED"
  | "PRIZE_FALLBACK_REQUIRED"
  | "ITEM_PRIZE_NO_POINTS"
  | "BOX_NOT_FOUND"
  | "PRIZE_NOT_FOUND"
  | "OPENING_NOT_FOUND"
  | "OPENING_NOT_PENDING"
  | "INVALID_ID";

export class LootBoxError extends Error {
  code: LootBoxErrorCode;
  status: number;

  constructor(code: LootBoxErrorCode, message: string, status = 400) {
    super(message);
    this.name = "LootBoxError";
    this.code = code;
    this.status = status;
  }
}

export const WEIGHT_FIELDS: { key: keyof BoxWeights; rarity: Rarity }[] = [
  { key: "weight_common", rarity: "common" },
  { key: "weight_rare", rarity: "rare" },
  { key: "weight_epic", rarity: "epic" },
  { key: "weight_legendary", rarity: "legendary" },
];

export function weightsSum(w: BoxWeights) {
  return w.weight_common + w.weight_rare + w.weight_epic + w.weight_legendary;
}

export type RuleIssue = { code: LootBoxErrorCode; message: string };

type RulePrize = { rarity: Rarity; kind: PrizeKind; is_active: boolean; stock: number | null };

/**
 * Un premio puede salir sorteado si está activo. Con el stock agotado SIGUE
 * en el pool: si sale, se pagan sus puntos de respaldo (`fallback_points`).
 */
export const isDrawable = (p: { is_active: boolean }) => p.is_active;

/**
 * Comprueba el estado completo de una caja. Los pesos siempre deben sumar
 * 10000; si la caja está (o va a estar) activa, además debe tener premio de
 * puntos común y premios en cada categoría con peso.
 */
export function boxRuleIssues(
  box: BoxWeights & { is_active: boolean },
  prizes: RulePrize[]
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const sum = weightsSum(box);
  if (sum !== WEIGHTS_TOTAL) {
    issues.push({
      code: "INVALID_WEIGHTS_SUM",
      message: `Los cuatro pesos deben sumar exactamente ${WEIGHTS_TOTAL} (ahora suman ${sum}).`,
    });
  }
  if (!box.is_active) return issues;

  const available = prizes.filter(isDrawable);
  if (!available.some((p) => p.rarity === "common" && p.kind === "points")) {
    issues.push({
      code: "BOX_NEEDS_COMMON_POINTS_PRIZE",
      message:
        "Una caja activa necesita al menos un premio Común de tipo puntos, activo (es lo mínimo que toca siempre).",
    });
  }
  for (const { key, rarity } of WEIGHT_FIELDS) {
    if (box[key] > 0 && !available.some((p) => p.rarity === rarity)) {
      issues.push({
        code: "CATEGORY_WITHOUT_PRIZES",
        message: `La categoría ${RARITY_LABELS[rarity]} tiene peso mayor que 0 pero ningún premio activo.`,
      });
    }
  }
  return issues;
}

export function assertBoxRules(
  box: BoxWeights & { is_active: boolean },
  prizes: RulePrize[]
) {
  const [first] = boxRuleIssues(box, prizes);
  if (first) throw new LootBoxError(first.code, first.message);
}

// ───────────────────────── esquemas zod ─────────────────────────

const optionalUrl = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v.trim() === "" ? null : v.trim()))
  .refine((v) => v === null || (v.length <= 2000 && /^https:\/\/\S+$/i.test(v)), {
    message: "La imagen debe ser una URL https:// válida o estar vacía",
  });

const optionalText = z
  .union([z.string().max(500, "Máximo 500 caracteres"), z.null()])
  .transform((v) => (v === null || v.trim() === "" ? null : v.trim()));

const name = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(120, "El nombre admite 120 caracteres como máximo");

const int = (label: string) =>
  z.number({ error: `${label} debe ser un número` }).int(`${label} debe ser un entero`);

const weight = (label: string) =>
  int(label).min(0, `${label} no puede ser negativo`).max(WEIGHTS_TOTAL, `${label} no puede superar ${WEIGHTS_TOTAL}`);

const boxShape = {
  name,
  description: optionalText,
  image: optionalUrl,
  price: int("El precio").min(1, "El precio debe ser al menos 1").max(100_000_000, "Precio demasiado alto"),
  weight_common: weight("El peso Común"),
  weight_rare: weight("El peso Raro"),
  weight_epic: weight("El peso Épico"),
  weight_legendary: weight("El peso Legendario"),
  position: int("La posición").min(-100000).max(100000),
  is_active: z.boolean(),
};

export const createBoxSchema = z.object({
  ...boxShape,
  position: boxShape.position.default(0),
  is_active: boxShape.is_active.default(false),
  description: boxShape.description.optional(),
  image: boxShape.image.optional(),
});

export const updateBoxSchema = z.object(boxShape).partial();

const prizeShape = {
  rarity: z.enum(RARITIES, { error: "Categoría no válida" }),
  kind: z.enum(["points", "item"], { error: "Tipo de premio no válido" }),
  name,
  description: optionalText,
  image: optionalUrl,
  points: z.union([int("Los puntos").min(1, "Los puntos deben ser al menos 1").max(100_000_000), z.null()]),
  weight: int("El peso").min(1, "El peso debe ser al menos 1").max(1_000_000, "Peso demasiado alto"),
  stock: z.union([int("El stock").min(0, "El stock no puede ser negativo").max(1_000_000_000), z.null()]),
  fallback_points: z.union([
    int("Los puntos de respaldo").min(1, "Los puntos de respaldo deben ser al menos 1").max(100_000_000),
    z.null(),
  ]),
  is_active: z.boolean(),
  position: int("La posición").min(-100000).max(100000),
};

export const createPrizeSchema = z.object({
  rarity: prizeShape.rarity,
  kind: prizeShape.kind,
  name: prizeShape.name,
  description: prizeShape.description.optional(),
  image: prizeShape.image.optional(),
  points: prizeShape.points.optional(),
  weight: prizeShape.weight.default(1),
  stock: prizeShape.stock.optional(),
  fallback_points: prizeShape.fallback_points.optional(),
  is_active: prizeShape.is_active.default(true),
  position: prizeShape.position.default(0),
});

export const updatePrizeSchema = z.object(prizeShape).partial();

/** Reglas de un premio suelto (coherencia tipo / puntos / categoría). */
export function assertPrizeShape(p: {
  rarity: Rarity;
  kind: PrizeKind;
  points: number | null;
  stock: number | null;
  fallback_points: number | null;
}) {
  if (p.rarity === "common" && p.kind !== "points") {
    throw new LootBoxError(
      "COMMON_PRIZE_MUST_BE_POINTS",
      "Un premio Común siempre es de tipo puntos: lo mínimo que toca en una caja son puntos."
    );
  }
  if (p.kind === "points" && (p.points === null || p.points < 1)) {
    throw new LootBoxError("PRIZE_POINTS_REQUIRED", "Un premio de puntos necesita un valor de puntos de al menos 1.");
  }
  if (p.kind === "item" && p.points !== null) {
    throw new LootBoxError("ITEM_PRIZE_NO_POINTS", "Un premio de tipo objeto no lleva puntos.");
  }
  if (p.stock !== null && (p.fallback_points === null || p.fallback_points < 1)) {
    throw new LootBoxError(
      "PRIZE_FALLBACK_REQUIRED",
      "Un premio con stock necesita puntos de respaldo (al menos 1): se dan si el stock se agota."
    );
  }
}

export function zodMessage(error: z.ZodError) {
  return error.issues.map((i) => i.message).join(". ");
}
