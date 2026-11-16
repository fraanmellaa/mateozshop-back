import { z } from "zod";

export const NEWS_LIMITS = {
  title: 160,
  summary: 300,
  body: 8000,
  tag: 30,
  url: 2000,
  linkText: 40,
} as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// URL https:// válida o vacía (vacío = null).
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(NEWS_LIMITS.url)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      if (new URL(value).protocol === "https:") return value;
    } catch {
      // cae al error de abajo
    }
    ctx.addIssue({ code: "custom", message: "La imagen debe ser una URL https:// válida" });
    return z.NEVER;
  });

/** Enlace del botón: URL http(s) absoluta o ruta interna ("/puntos"). Nunca "//host" ni otros esquemas. */
export function isSafeNewsLink(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !/[\\\s]/.test(value);
  }
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const optionalLink = z
  .string()
  .trim()
  .max(NEWS_LIMITS.url)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    if (isSafeNewsLink(value)) return value;
    ctx.addIssue({
      code: "custom",
      message: "El enlace debe ser una URL http(s) o una ruta interna que empiece por /",
    });
    return z.NEVER;
  });

export const newsSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(NEWS_LIMITS.title),
  summary: optionalText(NEWS_LIMITS.summary),
  body: z.string().max(NEWS_LIMITS.body),
  image: optionalHttpsUrl,
  tag: optionalText(NEWS_LIMITS.tag),
  link_url: optionalLink,
  link_text: optionalText(NEWS_LIMITS.linkText),
  pinned: z.boolean(),
  is_published: z.boolean(),
});

export const createNewsSchema = newsSchema.partial({
  summary: true,
  body: true,
  image: true,
  tag: true,
  link_url: true,
  link_text: true,
  pinned: true,
  is_published: true,
});

export const updateNewsSchema = newsSchema.partial();

export type NewsInput = z.infer<typeof createNewsSchema>;

// ───────────── slug ─────────────

export const NEWS_SLUG_MAX = 80;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isNewsSlug(value: string): boolean {
  return value.length <= NEWS_SLUG_MAX && SLUG_PATTERN.test(value);
}

/** "¡Vuelve el Torneo de Plinko!" -> "vuelve-el-torneo-de-plinko". Sin acentos ni símbolos. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "novedad";
}
