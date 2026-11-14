import { z } from "zod";

// URL https:// válida o vacía (vacío = null).
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      if (new URL(value).protocol === "https:") return value;
    } catch {
      // cae al error de abajo
    }
    ctx.addIssue({ code: "custom", message: "Debe ser una URL https:// válida" });
    return z.NEVER;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// Lista de códigos ISO alfa-2: mayúsculas, sin vacíos ni duplicados.
const countryList = z
  .array(z.string())
  .max(250)
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const raw of list) {
      const code = raw.trim().toUpperCase();
      if (!code) continue;
      if (!/^[A-Z]{2}$/.test(code)) {
        ctx.addIssue({
          code: "custom",
          message: `"${raw}" no es un código de país de 2 letras`,
        });
        return z.NEVER;
      }
      if (!out.includes(code)) out.push(code);
    }
    return out;
  });

export const bonusSchema = z.object({
  casino_name: z.string().trim().min(1).max(120),
  offer: z.string().trim().min(1).max(200),
  description: optionalText(500),
  image: optionalHttpsUrl,
  url: optionalHttpsUrl,
  countries: countryList,
  blocked_countries: countryList,
  position: z.number().int().min(-100000).max(100000),
  is_active: z.boolean(),
});

// Para crear: description/image/url/position/is_active son opcionales.
export const createBonusSchema = bonusSchema.partial({
  description: true,
  image: true,
  url: true,
  countries: true,
  blocked_countries: true,
  position: true,
  is_active: true,
});

// Para editar: todo opcional (solo se tocan los campos enviados).
export const updateBonusSchema = bonusSchema.partial();

/** Un país no puede estar a la vez en la lista blanca y en la negra. */
export function countryListsOverlap(data: {
  countries?: string[];
  blocked_countries?: string[];
}): string | null {
  const blocked = new Set(data.blocked_countries ?? []);
  const both = (data.countries ?? []).filter((c) => blocked.has(c));
  return both.length
    ? `El país ${both.join(", ")} no puede estar en las dos listas`
    : null;
}
