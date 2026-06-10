import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/drizzle";
import { users } from "@/db/schema";
import { validateExtensionKey, verifyExtensionUser } from "@/app/utils/extensionAuth";

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

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.discord_id, verified.discordId));

  const user = userRows[0];
  if (!user) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const available = user.total_points - user.used_points;
  if (available < body.amount) {
    return NextResponse.json({ error: "NOT_ENOUGH_POINTS" }, { status: 400 });
  }

  const updated = await db
    .update(users)
    .set({ used_points: user.used_points + body.amount })
    .where(eq(users.discord_id, verified.discordId))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const after = updated[0];
  const points = after.total_points - after.used_points;

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
