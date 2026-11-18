import { NextRequest, NextResponse } from "next/server";

import { getUserByDiscordId } from "@/app/utils/users";
import {
  PROOF_MAX_BYTES,
  convertProofToWebp,
  detectProofImage,
  saveProofDraft,
} from "@/app/utils/verification";

import { fail, failure } from "../shared";

// Sube UNA captura de la solicitud de verificación (multipart: `kind` =
// welcome | deposit, y `file`). Solo jpg, png o webp de hasta 3 MB. Se
// convierte a WebP y queda como borrador del usuario hasta que envíe la
// solicitud. Van de una en una porque las dos juntas no caben en una petición.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: discordId } = await params;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("INVALID_REQUEST", 400);

  const kind = form.get("kind");
  if (kind !== "welcome" && kind !== "deposit") return fail("INVALID_REQUEST", 400);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("PROOF_REQUIRED", 400);
  if (file.size > PROOF_MAX_BYTES) return fail("FILE_TOO_LARGE", 413);

  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) return fail("USER_NOT_FOUND", 404);
    if (user.is_banned) return fail("USER_BANNED", 403);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!detectProofImage(bytes)) return fail("FILE_TYPE_NOT_ALLOWED", 400);
    const webp = await convertProofToWebp(bytes);
    if (!webp) return fail("FILE_TYPE_NOT_ALLOWED", 400);

    await saveProofDraft(user.id, kind, webp);
    return NextResponse.json({ success: true, data: { kind, bytes: webp.length } });
  } catch (error) {
    return failure(error);
  }
}
