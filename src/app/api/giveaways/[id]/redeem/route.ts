import { getGiveawayById } from "@/app/utils/giveaways";
import { getUserByDiscordId } from "@/app/utils/users";
import { db } from "@/db/drizzle";
import { giveaways_entries, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  discord_id: z.string(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const product_id = resolvedParams.id;

  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error },
        { status: 400 }
      );
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  }

  const { discord_id } = body;

  const user = await getUserByDiscordId(discord_id);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const actualPoints = user?.actual_points ?? 0;

  if (actualPoints < 0) {
    return NextResponse.json(
      { success: false, error: "NOT_ENOUGH_POINTS" },
      { status: 400 }
    );
  }

  const product = await getGiveawayById(parseInt(product_id));

  if (!product) {
    return NextResponse.json(
      { success: false, error: "PRODUCT_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (actualPoints < product.cost) {
    return NextResponse.json(
      { success: false, error: "NOT_ENOUGH_POINTS" },
      { status: 400 }
    );
  }

  const userKickId = user.kick_id;

  if (!userKickId) {
    return NextResponse.json(
      { success: false, error: "USER_KICK_ID_NOT_FOUND" },
      { status: 404 }
    );
  }

  let order;
  try {
    await db.transaction(async (tx) => {
      const newUsedPoints = user.used_points + product.cost;
      await tx
        .update(users)
        .set({
          used_points: newUsedPoints,
        })
        .where(eq(users.kick_id, userKickId.toString()))
        .returning();

      order = await tx
        .insert(giveaways_entries)
        .values({
          user_id: user.id,
          giveaway_id: product.id,
        })
        .returning()
        .then((res) => res[0]);

      return order;
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }

  // TODO: ¿¿enviar correo??

  return NextResponse.json(
    {
      success: true,
      data: order,
    },
    {
      status: 200,
    }
  );
}
