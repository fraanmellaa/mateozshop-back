import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "bonus-logos";
const MAX_BYTES = 1024 * 1024; // 1 MB

type Detected = { ext: "png" | "jpg" | "webp"; contentType: string };

/** Detecta el tipo por los bytes iniciales (no se fía del type del cliente). SVG no se admite. */
function detectImage(bytes: Uint8Array): Detected | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((b, i) => bytes[offset + i] === b);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: "png", contentType: "image/png" };
  }
  if (startsWith([0xff, 0xd8, 0xff])) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  // WebP: "RIFF" .... "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

const fail = (error: string, message: string, status: number) =>
  NextResponse.json({ success: false, error, message }, { status });

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("FILE_REQUIRED", "Selecciona un archivo de imagen", 400);
  }
  if (file.size > MAX_BYTES) {
    return fail("FILE_TOO_LARGE", "El archivo supera el máximo de 1 MB", 413);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return fail("FILE_TOO_LARGE", "El archivo supera el máximo de 1 MB", 413);
  }
  const detected = detectImage(buffer);
  if (!detected) {
    return fail(
      "FILE_TYPE_NOT_ALLOWED",
      "Formato no permitido: usa PNG, JPG o WebP",
      400
    );
  }

  const path = `${crypto.randomUUID()}.${detected.ext}`;
  try {
    const storage = getSupabaseAdmin().storage.from(BUCKET);
    const { error } = await storage.upload(path, buffer, {
      contentType: detected.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) throw error;
    const { data } = storage.getPublicUrl(path);
    return NextResponse.json({ success: true, url: data.publicUrl });
  } catch (error) {
    console.error("Error uploading bonus logo:", error);
    return fail("UPLOAD_FAILED", "No se pudo subir el logo. Inténtalo de nuevo", 500);
  }
}
