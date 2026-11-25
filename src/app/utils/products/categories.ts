import { isMissingColumn } from "./currency";

// Categorías de los premios de la tienda (columna `products.category`, ver la
// migración 0031). La clave es la que se guarda; el nombre es el del panel.
// La web pública tiene la misma lista con sus iconos
// (mateozshop-front: src/app/lib/productCategories.ts): al añadir una, añádela
// en los dos sitios.
export const PRODUCT_CATEGORIES = [
  { key: "verificados", label: "Verificados" },
  { key: "casino", label: "Casino" },
  { key: "tarjetas", label: "Tarjetas regalo" },
  { key: "skins", label: "Skins" },
  { key: "gaming", label: "Gaming" },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["key"];

export const PRODUCT_CATEGORY_KEYS = PRODUCT_CATEGORIES.map((c) => c.key) as [
  ProductCategory,
  ...ProductCategory[],
];

/**
 * true si el error de Supabase es porque la columna `category` aún no existe
 * (migración 0031 sin aplicar). Mientras no exista, la tienda funciona sin
 * categorías y el panel avisa al intentar guardar una.
 */
export function isMissingCategoryColumn(error: unknown): boolean {
  return isMissingColumn(error, "category");
}

export const CATEGORY_MIGRATION_ERROR =
  "Para guardar categorías falta aplicar la migración 0031 (products.category) en Supabase";
