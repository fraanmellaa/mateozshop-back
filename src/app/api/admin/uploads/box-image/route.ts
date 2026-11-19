import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Ilustraciones de las cajas y de sus premios. Van al mismo almacén público que
// los logos de los bonos, en su propia carpeta.
const BUCKET = "bonus-logos";
const FOLDER = "cajas";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB antes de convertir
const MAX_SIDE = 800; // px del lado mayor tras convertir

/** PNG, JPG o WebP según los bytes iniciales (no se fía del tipo que dice el navegador). */
function isImage(bytes: Uint8Array): boolean {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  return (
    startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    startsWith([0xff, 0xd8, 0xff]) ||
    (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8))
  );
}

const fail = (error: string, message: string, status: number) =>
  NextResponse.json({ success: false, error, message }, { status });

/**
 * Sube la ilustración de una caja o de un premio. La imagen se guarda en WebP
 * (con su transparencia) y como mucho a 800 px de lado, para que pese poco.
 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("FILE_REQUIRED", "Selecciona un archivo de imagen", 400);
  }
  if (file.size > MAX_BYTES) {
    return fail("FILE_TOO_LARGE", "El archivo supera el máximo de 5 MB", 413);
  }
  const input = new Uint8Array(await file.arrayBuffer());
  if (!isImage(input)) {
    return fail("FILE_TYPE_NOT_ALLOWED", "Formato no permitido: usa PNG, JPG o WebP", 400);
  }

  let webp: Buffer;
  try {
    webp = await sharp(input)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
  } catch (error) {
    console.error("Error converting box image:", error);
    return fail("FILE_TYPE_NOT_ALLOWED", "No se pudo leer la imagen: prueba con otra", 400);
  }

  const path = `${FOLDER}/${crypto.randomUUID()}.webp`;
  try {
    const storage = getSupabaseAdmin().storage.from(BUCKET);
    const { error } = await storage.upload(path, webp, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) throw error;
    const { data } = storage.getPublicUrl(path);
    return NextResponse.json({ success: true, url: data.publicUrl });
  } catch (error) {
    console.error("Error uploading box image:", error);
    return fail("UPLOAD_FAILED", "No se pudo subir la imagen. Inténtalo de nuevo", 500);
  }
}
