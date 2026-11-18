import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  PROOF_MAX_BYTES,
  VerificationError,
  detectProofImage,
  getLatestVerificationRequest,
  getVerifiedCasinos,
  requestVerification,
} from "@/app/utils/verification";

// Verificación de afiliados (contrato con la web): estado y solicitud.
// `[id]` es el id de Discord, como en el resto de rutas de /api/user.

const STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  USER_NOT_FOUND: 404,
  USER_BANNED: 403,
  REQUEST_PENDING: 409,
  CASINO_ALREADY_VERIFIED: 409,
  CASINO_USER_TAKEN: 409,
};

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

function failure(error: unknown) {
  if (error instanceof VipUnavailableError) return fail("VERIFICATION_UNAVAILABLE", 503);
  if (error instanceof VerificationError) return fail(error.code, STATUS[error.code] ?? 400);
  console.error("Error in user verification:", error);
  return fail("INTERNAL_SERVER_ERROR", 500);
}

const publicRequest = (r: Awaited<ReturnType<typeof getLatestVerificationRequest>>) =>
  r
    ? {
        id: r.id,
        casino: r.casino,
        casino_username: r.casino_username,
        status: r.status,
        note: r.status === "rejected" ? r.note : null,
        created_at: r.created_at,
      }
    : null;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: discordId } = await params;
  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) return fail("USER_NOT_FOUND", 404);

    const [request, casinos] = await Promise.all([
      getLatestVerificationRequest(user.id),
      getVerifiedCasinos(user.id),
    ]);
    return NextResponse.json({
      success: true,
      data: { verified: Boolean(user.is_verified), casinos, request: publicRequest(request) },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Nombre tal cual está en Bonos del casino elegido, o null si no es de la lista. */
async function findCasino(name: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().from("bonuses").select("casino_name").eq("is_active", true);
  if (error) throw error;
  const wanted = name.trim().toLowerCase();
  const match = (data ?? []).find((row) => String(row.casino_name).trim().toLowerCase() === wanted);
  return match ? String(match.casino_name).trim() : null;
}

type ProofError = "PROOF_REQUIRED" | "FILE_TOO_LARGE" | "FILE_TYPE_NOT_ALLOWED";

/** Lee una captura del formulario: solo jpg, png o webp de hasta 5 MB. */
async function readProof(value: FormDataEntryValue | null) {
  const bad = (error: ProofError) => ({ ok: false as const, error });
  if (!(value instanceof File) || value.size === 0) return bad("PROOF_REQUIRED");
  if (value.size > PROOF_MAX_BYTES) return bad("FILE_TOO_LARGE");
  const bytes = new Uint8Array(await value.arrayBuffer());
  const image = detectProofImage(bytes);
  if (!image) return bad("FILE_TYPE_NOT_ALLOWED");
  return { ok: true as const, bytes, image };
}

// Solicitud: multipart con `casino`, `casino_username`, `accept` ("1": mayor de
// 18 y acepta términos y privacidad), `registered` ("1": se registró desde
// nuestros enlaces) y las dos capturas, `welcome` y `deposit`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: discordId } = await params;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("INVALID_REQUEST", 400);

  const casinoInput = String(form.get("casino") ?? "").trim();
  const casinoUsername = String(form.get("casino_username") ?? "").trim();
  if (!casinoInput || !casinoUsername || casinoInput.length > 120 || casinoUsername.length > 80) {
    return fail("INVALID_REQUEST", 400);
  }
  if (form.get("accept") !== "1") return fail("ACCEPT_REQUIRED", 400);
  // Segunda casilla: declara que se registró desde los enlaces de MateoZ Shop.
  if (form.get("registered") !== "1") return fail("REGISTERED_REQUIRED", 400);

  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) return fail("USER_NOT_FOUND", 404);

    // Antes de subir nada: si la verificación no está activada o ya hay una
    // solicitud en revisión, se corta aquí.
    const latest = await getLatestVerificationRequest(user.id);
    if (latest?.status === "pending") return fail("REQUEST_PENDING", 409);

    const casino = await findCasino(casinoInput);
    if (!casino) return fail("INVALID_CASINO", 400);

    const welcome = await readProof(form.get("welcome"));
    if (!welcome.ok) return fail(welcome.error, welcome.error === "FILE_TOO_LARGE" ? 413 : 400);
    const deposit = await readProof(form.get("deposit"));
    if (!deposit.ok) return fail(deposit.error, deposit.error === "FILE_TOO_LARGE" ? 413 : 400);

    const created = await requestVerification(user.id, { casino, casinoUsername, welcome, deposit });
    return NextResponse.json({
      success: true,
      data: {
        verified: Boolean(user.is_verified),
        casinos: await getVerifiedCasinos(user.id),
        request: { ...created, note: null },
      },
    });
  } catch (error) {
    return failure(error);
  }
}
