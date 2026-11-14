import type { Rarity } from "@/app/utils/lootBoxes/types";

/** Colores de cada categoría (clases de Tailwind). */
export const RARITY_STYLES: Record<Rarity, { badge: string; border: string; dot: string }> = {
  common: {
    badge: "text-gray-200 bg-gray-500/20",
    border: "border-gray-500/40",
    dot: "bg-gray-400",
  },
  rare: {
    badge: "text-blue-300 bg-blue-500/20",
    border: "border-blue-500/40",
    dot: "bg-blue-400",
  },
  epic: {
    badge: "text-purple-300 bg-purple-500/20",
    border: "border-purple-500/40",
    dot: "bg-purple-400",
  },
  legendary: {
    badge: "text-amber-300 bg-amber-500/20",
    border: "border-amber-500/40",
    dot: "bg-amber-400",
  },
};

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Mensaje de error del servidor tal cual (message en español, o el código). */
export async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return (body && (body.message || body.error)) || fallback;
}
