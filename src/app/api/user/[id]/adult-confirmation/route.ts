import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { confirmAdult, getUserByDiscordId, toPublicUser } from "@/app/utils/users";

const bodySchema = z.object({
  terms_accepted: z.literal(true),
});

// Confirma que el usuario (ya registrado) es mayor de 18 y acepta los términos.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const user = await getUserByDiscordId(discordId);
  if (!user) {
    return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const updated = await confirmAdult(user.id, true);
  if (!updated) {
    return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: toPublicUser(updated) });
}
