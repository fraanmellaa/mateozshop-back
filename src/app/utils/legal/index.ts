import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const LEGAL_SLUGS = [
  "aviso-legal",
  "terminos",
  "privacidad",
  "cookies",
  "juego-responsable",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const isLegalSlug = (value: string): value is LegalSlug =>
  (LEGAL_SLUGS as readonly string[]).includes(value);

export interface LegalPage {
  slug: LegalSlug;
  title: string;
  body: string;
  updated_at: number;
}

export const legalPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000),
});

const COLUMNS = "slug, title, body, updated_at";

/** Página pública; null si no existe o no tiene cuerpo. El cuerpo es texto plano. */
export async function getPublicLegalPage(slug: LegalSlug): Promise<LegalPage | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("legal_pages")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  const page = data as LegalPage | null;
  return page && page.body.trim() ? page : null;
}

export async function getAllLegalPages(): Promise<LegalPage[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("legal_pages")
    .select(COLUMNS);

  if (error) throw error;
  const rows = (data ?? []) as LegalPage[];
  return LEGAL_SLUGS.map((slug) => rows.find((r) => r.slug === slug)).filter(
    (p): p is LegalPage => !!p
  );
}

export async function saveLegalPage(
  slug: LegalSlug,
  input: { title: string; body: string }
): Promise<LegalPage> {
  const { data, error } = await getSupabaseAdmin()
    .from("legal_pages")
    .upsert(
      { slug, title: input.title, body: input.body, updated_at: Math.floor(Date.now() / 1000) },
      { onConflict: "slug" }
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as LegalPage;
}
