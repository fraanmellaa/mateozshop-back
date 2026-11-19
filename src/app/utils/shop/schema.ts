import { z } from "zod";

/**
 * Esquema y valores por defecto de los ajustes de la tienda (clave `shop` de
 * `app_settings`). Módulo puro: lo usan el servidor y el formulario del panel.
 * place_bid, auction_settle y verification_review (migraciones 0023 y 0039)
 * leen los mismos campos con los mismos defaults.
 */

export const shopSettingsSchema = z
  .object({
    /** Duración de la puja desde la primera puja. */
    battleMinutes: z.number().int().min(1).max(1440),
    /** Una puja dentro de estos minutos finales alarga la cuenta atrás. */
    extendWindowMinutes: z.number().int().min(0).max(120),
    /** Minutos que se suman al cierre actual. */
    extendMinutes: z.number().int().min(0).max(120),
    /** Subida mínima sobre la puja actual, en %. */
    minIncrementPct: z.number().min(1).max(100),
    /** Premios que puede ganar una persona al mes (mes de Andorra). */
    maxWinsPerMonth: z.number().int().min(1).max(1000),
    /** Pujas normales (no VIP) que pueden estar abiertas a la vez. */
    maxOpenAuctions: z.number().int().min(1).max(1000),
    /** Antigüedad mínima de la cuenta de Kick/Twitch para pujar. */
    minAccountAgeDays: z.number().int().min(0).max(3650),
    /** Los premios que valgan más de esto (€) requieren revisión manual. */
    reviewThresholdEur: z.number().min(0).max(1_000_000),
    /**
     * Puntos VIP que gana cada minuto de directo un usuario verificado en UN
     * casino (además de sus puntos normales). 0 = no se reparten.
     */
    vipPointsPerMinute: z.number().int().min(0).max(1000),
    /** Ídem con 2 casinos verificados. */
    vipPointsPerMinuteTwo: z.number().int().min(0).max(1000),
    /** Ídem con 3 casinos verificados o más (tope). */
    vipPointsPerMinuteThree: z.number().int().min(0).max(1000),
    /** 1 = los saldos VIP se ponen a cero en el reinicio mensual; 0 = se conservan. */
    vipMonthlyReset: z.number().int().min(0).max(1),
    /**
     * Puntos VIP de bienvenida al aprobarse una verificación (una vez por
     * casino). 0 = no se dan.
     */
    vipWelcomePoints: z.number().int().min(0).max(1_000_000),
  })
  .refine((v) => v.extendWindowMinutes <= v.battleMinutes, {
    message: "La ventana de prórroga no puede superar la duración de la puja",
    path: ["extendWindowMinutes"],
  });

export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  battleMinutes: 30,
  extendWindowMinutes: 2,
  extendMinutes: 2,
  minIncrementPct: 5,
  maxWinsPerMonth: 3,
  maxOpenAuctions: 3,
  minAccountAgeDays: 30,
  reviewThresholdEur: 25,
  vipPointsPerMinute: 10,
  vipPointsPerMinuteTwo: 15,
  vipPointsPerMinuteThree: 20,
  vipMonthlyReset: 1,
  vipWelcomePoints: 5000,
};

/**
 * Hora (de Andorra) a partir de la cual, el último día del mes, ya no se abren
 * pujas. Fija: la aplica `auction_opening_blocked` (migración 0039).
 */
export const LAST_DAY_CUTOFF_HOUR = 23;

const andorraMonth = (seconds: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Andorra", year: "numeric", month: "2-digit" }).format(
    new Date(seconds * 1000)
  );

/**
 * ¿Ha llegado la fecha de apertura de un premio VIP? Solo mira la fecha (tiene
 * que estar puesta, haber llegado y ser de este mes). Si además su directo ya
 * pasó lo dice `vip_product_state` (migración 0039), que es quien manda.
 */
export function vipDateReached(availableFrom: number | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!availableFrom || nowSeconds < availableFrom) return false;
  return andorraMonth(availableFrom) === andorraMonth(nowSeconds);
}

export type SettingsIssue = { path: string; message: string };

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

export function shopSettingsIssues(error: z.ZodError): SettingsIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issueMessage(issue),
  }));
}

/** Puja mínima siguiente: lo que se muestra y lo que exige place_bid. */
export function minNextBid(
  price: number,
  currentBid: number,
  hasBidder: boolean,
  minIncrementPct: number
): number {
  if (!hasBidder) return Math.max(price, 1);
  const step = Math.max(Math.ceil((currentBid * minIncrementPct) / 100), 1);
  return Math.max(price, currentBid + step);
}
