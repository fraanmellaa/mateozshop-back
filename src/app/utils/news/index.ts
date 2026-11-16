import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { isNewsSlug, NewsInput, slugify } from "./schema";

/** Lo que ve la web en el listado (sin el cuerpo, para no cargar de más). */
export interface PublicNewsItem {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  tag: string | null;
  link_url: string | null;
  link_text: string | null;
  pinned: boolean;
  published_at: number | null;
}

/** Detalle público: añade el cuerpo (texto plano). */
export interface PublicNews extends PublicNewsItem {
  body: string;
}

export interface News extends PublicNews {
  is_published: boolean;
  created_at: number;
  updated_at: number;
}

export const NEWS_PAGE_SIZE = 10;

const LIST_COLUMNS =
  "id, slug, title, summary, image, tag, link_url, link_text, pinned, published_at";
const PUBLIC_COLUMNS = `${LIST_COLUMNS}, body`;
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, is_published, created_at, updated_at`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Novedades publicadas: fijadas primero y luego por fecha. page empieza en 1. */
export async function getPublishedNews(page: number) {
  const from = (page - 1) * NEWS_PAGE_SIZE;
  const { data, error, count } = await getSupabaseAdmin()
    .from("news")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("is_published", true)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + NEWS_PAGE_SIZE - 1);

  if (error) throw error;
  const result = (data ?? []) as unknown as PublicNewsItem[];
  const total = count ?? result.length;
  return {
    result,
    page,
    pageSize: NEWS_PAGE_SIZE,
    total,
    hasMore: from + result.length < total,
  };
}

/** Una novedad publicada por su slug; null si no existe o es borrador. */
export async function getPublishedNewsBySlug(slug: string): Promise<PublicNews | null> {
  if (!isNewsSlug(slug)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("news")
    .select(PUBLIC_COLUMNS)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as PublicNews | null) ?? null;
}

export async function getAllNews(): Promise<News[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("news")
    .select(ADMIN_COLUMNS)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as unknown as News[];
}

/** Slug libre a partir del título: "titulo", "titulo-2", "titulo-3"... */
async function freeSlug(title: string): Promise<string> {
  const base = slugify(title);
  const { data, error } = await getSupabaseAdmin()
    .from("news")
    .select("slug")
    .like("slug", `${base}%`)
    .limit(1000);

  if (error) throw error;
  const taken = new Set((data ?? []).map((row) => row.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export async function createNews(input: NewsInput): Promise<News> {
  const published = input.is_published ?? false;

  // El índice único decide: si dos altas simultáneas chocan en el slug, se reintenta.
  for (let attempt = 0; ; attempt++) {
    const now = nowSeconds();
    const { data, error } = await getSupabaseAdmin()
      .from("news")
      .insert({
        title: input.title,
        slug: await freeSlug(input.title),
        summary: input.summary ?? null,
        body: input.body ?? "",
        image: input.image ?? null,
        tag: input.tag ?? null,
        link_url: input.link_url ?? null,
        link_text: input.link_text ?? null,
        pinned: input.pinned ?? false,
        is_published: published,
        published_at: published ? now : null,
        created_at: now,
        updated_at: now,
      })
      .select(ADMIN_COLUMNS)
      .single();

    if (!error) return data as unknown as News;
    if (error.code !== "23505" || attempt >= 3) throw error;
  }
}

/**
 * Actualización parcial. Devuelve null si no existe. El slug no cambia aunque
 * cambie el título, para no romper enlaces ya compartidos.
 */
export async function updateNews(
  id: number,
  input: Partial<NewsInput>
): Promise<News | null> {
  const now = nowSeconds();
  const patch: Record<string, unknown> = { updated_at: now };
  for (const key of [
    "title",
    "summary",
    "body",
    "image",
    "tag",
    "link_url",
    "link_text",
    "pinned",
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  if (input.is_published !== undefined) {
    patch.is_published = input.is_published;
    if (input.is_published) {
      // La fecha de publicación se fija la primera vez que se publica.
      const { data: current, error: readError } = await getSupabaseAdmin()
        .from("news")
        .select("published_at")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) return null;
      if (current.published_at === null) patch.published_at = now;
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from("news")
    .update(patch)
    .eq("id", id)
    .select(ADMIN_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as News | null) ?? null;
}

export async function deleteNews(id: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("news")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
