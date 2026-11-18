import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUserByDiscordId } from "@/app/utils/users";
import {
  type VerificationRequest,
  getVerifiedCasinos,
  listUserVerificationRequests,
  requestVerification,
} from "@/app/utils/verification";

import { fail, failure } from "./shared";

// Verificación de afiliados (contrato con la web): estado y solicitud.
// `[id]` es el id de Discord, como en el resto de rutas de /api/user.

/** Lo que ve el usuario de una solicitud suya. El motivo solo si se rechazó. */
const publicRequest = (r: VerificationRequest) => ({
  id: r.id,
  casino: r.casino,
  casino_username: r.casino_username,
  status: r.status,
  note: r.status === "rejected" ? r.note : null,
  created_at: r.created_at,
  reviewed_at: r.reviewed_at,
});

/** Estado completo: verificado o no, casinos aprobados, la última solicitud y el historial. */
async function verificationState(userId: number, verified: boolean) {
  const [requests, casinos] = await Promise.all([
    listUserVerificationRequests(userId),
    getVerifiedCasinos(userId),
  ]);
  const list = requests.map(publicRequest);
  return { verified, casinos, request: list[0] ?? null, requests: list };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: discordId } = await params;
  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) return fail("USER_NOT_FOUND", 404);
    return NextResponse.json({
      success: true,
      data: await verificationState(user.id, Boolean(user.is_verified)),
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

const bodySchema = z.object({
  casino: z.string().trim().min(1).max(120),
  casino_username: z.string().trim().min(1).max(80),
  accept: z.unknown().optional(),
  registered: z.unknown().optional(),
});

// Solicitud: JSON con `casino`, `casino_username`, `accept` (true: mayor de 18
// y acepta términos y privacidad) y `registered` (true: se registró desde
// nuestros enlaces). Las dos capturas se suben antes, de una en una, por
// `verification/proof`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: discordId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_REQUEST", 400);
  if (parsed.data.accept !== true) return fail("ACCEPT_REQUIRED", 400);
  // Segunda casilla: declara que se registró desde los enlaces de MateoZ Shop.
  if (parsed.data.registered !== true) return fail("REGISTERED_REQUIRED", 400);

  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) return fail("USER_NOT_FOUND", 404);

    const casino = await findCasino(parsed.data.casino);
    if (!casino) return fail("INVALID_CASINO", 400);

    await requestVerification(user.id, { casino, casinoUsername: parsed.data.casino_username });
    return NextResponse.json({
      success: true,
      data: await verificationState(user.id, Boolean(user.is_verified)),
    });
  } catch (error) {
    return failure(error);
  }
}
