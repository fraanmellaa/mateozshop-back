import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getUserByDiscordId } from "@/app/utils/users";
import { removeUserVerification } from "@/app/utils/verification";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({ confirm: z.literal(true) });

// Códigos que lanza user_delete_account (RAISE EXCEPTION 'CODIGO').
const BUSINESS_ERRORS: Record<string, number> = {
  ACTIVE_BIDS: 409,
  PENDING_ORDERS: 409,
  PENDING_PRIZES: 409,
  USER_NOT_FOUND: 404,
};

/**
 * Baja de cuenta: anonimiza al usuario (ver migrations/0026). El `id` de la
 * ruta es el discord_id que pone el servidor del front desde la sesión.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "INVALID_REQUEST_BODY" },
      { status: 400 }
    );
  }

  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const { error } = await getSupabaseAdmin().rpc("user_delete_account", {
      p_user_id: user.id,
    });
    if (error) {
      const status = BUSINESS_ERRORS[error.message];
      if (status) {
        return NextResponse.json({ success: false, error: error.message }, { status });
      }
      throw error;
    }

    // Con la cuenta se van sus datos de verificación: capturas, casino y usuario del casino.
    await removeUserVerification(user.id);

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
