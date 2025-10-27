import { sendEmail } from "@/app/utils/email";
import { getProductById } from "@/app/utils/products";
import { getUserByDiscordId } from "@/app/utils/users";
import { db } from "@/db/drizzle";
import { orders, products, users } from "@/db/schema";
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

  const product = await getProductById(parseInt(product_id));

  if (!product) {
    return NextResponse.json(
      { success: false, error: "PRODUCT_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (actualPoints < product.price) {
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
      const newUsedPoints = user.used_points + product.price;
      await tx
        .update(users)
        .set({
          used_points: newUsedPoints,
        })
        .where(eq(users.kick_id, userKickId.toString()))
        .returning();

      order = await tx
        .insert(orders)
        .values({
          user_id: user.id,
          product_id: product.id,
          status: 0, // 0: pending
          total: product.price,
          created_at: Math.floor(Date.now() / 1000), // Timestamp in seconds
        })
        .returning();

      await tx
        .update(products)
        .set({ stock: product.stock - 1 })
        .where(eq(products.id, product.id));
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }

  const email = user.email;

  if (product.sendable && email) {
    const firstCode = product.codes.length ? product.codes[0] : undefined;
    await sendEmail(email, "PRODUCT_WITH_REWARD", firstCode);
    const newCodes = product.codes.filter((code) => code !== firstCode);
    const updatedUsedCodes = [...product.used_codes, firstCode!];

    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ codes: newCodes, used_codes: updatedUsedCodes })
        .where(eq(products.id, product.id));
    });
  } else {
    await sendEmail(email, "PRODUCT_NO_REWARD");
  }

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
