import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { validateExtensionKey, verifyExtensionUser } from "@/app/utils/extensionAuth";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

const bodySchema = z.object({
  amount: z.number().int().positive(),
  source: z.string().min(1).max(120).optional(),
  idempotencyKey: z.string().min(1).max(160).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const keyError = validateExtensionKey(request);
  if (keyError) return keyError;

  const verified = await verifyExtensionUser(request);
  if (!verified.ok) return verified.response;

  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_REQUEST_BODY", details: error.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const { data: userRows, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("discord_id", verified.discordId);

  if (userError) {
    return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }

  const user = userRows[0];
  if (!user) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("users")
    .update({ total_points: user.total_points + body.amount })
    .eq("discord_id", verified.discordId)
    .select("*");

  if (updateError) {
    return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }

  if (updated.length === 0) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const updatedUser = updated[0];
  const points = updatedUser.total_points - updatedUser.used_points;

  return NextResponse.json(
    {
      success: true,
      data: {
        points,
      },
    },
    { status: 200 }
  );
}
