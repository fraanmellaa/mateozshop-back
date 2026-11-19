// Moneda en la que se puja un premio (columna `products.currency`, migración
// 0032). `vip` = puntos VIP: solo los ganan y los usan los usuarios verificados.
// La web pública enseña los premios en VIP dentro de la categoría «Verificados».
export const PRODUCT_CURRENCIES = [
  { key: "points", label: "Puntos (todo el mundo)" },
  { key: "vip", label: "Puntos VIP (solo verificados)" },
] as const;

export type ProductCurrency = (typeof PRODUCT_CURRENCIES)[number]["key"];

export const PRODUCT_CURRENCY_KEYS = ["points", "vip"] as const satisfies readonly ProductCurrency[];

type DbError = { code?: string; message?: string } | null;

/** true si el error de Supabase es porque esa columna todavía no existe. */
export function isMissingColumn(error: unknown, column: string): boolean {
  const e = error as DbError;
  if (!e) return false;
  return (
    (e.code === "42703" || e.code === "PGRST204") &&
    new RegExp(`\\b${column}\\b`, "i").test(e.message ?? "")
  );
}

/** true si el error es porque esa función SQL todavía no existe. */
export function isMissingFunction(error: unknown, fn: string): boolean {
  const e = error as DbError;
  if (!e) return false;
  return (e.code === "PGRST202" || e.code === "42883") && (e.message ?? "").includes(fn);
}

/** true si el error es porque esa tabla todavía no existe. */
export function isMissingTable(error: unknown, table: string): boolean {
  const e = error as DbError;
  if (!e) return false;
  return (e.code === "PGRST205" || e.code === "42P01") && (e.message ?? "").includes(table);
}

/**
 * true si el error viene de que la migración 0032 (puntos VIP) no está aplicada:
 * falta alguna de sus columnas o de sus funciones. Mientras no se aplique, todo
 * lo de puntos VIP queda apagado y el resto de la tienda funciona igual.
 */
export function isMissingVipSchema(error: unknown): boolean {
  return (
    ["currency", "is_verified", "verified_at", "vip_points"].some((c) => isMissingColumn(error, c)) ||
    [
      "vip_move",
      "vip_watch_tick",
      "vip_reset_balances",
      "wallet_move",
      "verification_request",
      "verification_review",
    ].some((f) => isMissingFunction(error, f)) ||
    isMissingTable(error, "verification_requests")
  );
}

/** true si falta alguna columna de la migración 0039 (fecha de apertura y tope). */
export function isMissingAuctionRulesColumn(error: unknown): boolean {
  return ["available_from", "counts_for_cap"].some((c) => isMissingColumn(error, c));
}

export const AUCTION_RULES_MIGRATION_ERROR =
  "Para usar «Disponible desde» y «No cuenta para el tope» falta aplicar la migración 0039 en Supabase";

export const VIP_MIGRATION_ERROR =
  "Para usar puntos VIP falta aplicar la migración 0032 (puntos VIP) en Supabase";
