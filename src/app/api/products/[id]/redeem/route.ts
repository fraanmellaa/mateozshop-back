import { sendEmail } from "@/app/utils/email";
import { getProductById } from "@/app/utils/products";
import { getUserByDiscordId } from "@/app/utils/users";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

const bodySchema = z.object({
  discord_id: z.string(),
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

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

  if (product.is_auction) {
    return NextResponse.json(
      { success: false, error: "AUCTION_PRODUCT_USE_BID" },
      { status: 400 }
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
    const newUsedPoints = user.used_points + product.price;
    const { error: userUpdateError } = await supabase
      .from("users")
      .update({ used_points: newUsedPoints })
      .eq("kick_id", userKickId.toString());

    if (userUpdateError) {
      throw userUpdateError;
    }

      // Si el producto es sendable, crear el pedido como completado (estado 1)
      // Si no es sendable, crear como pendiente (estado 0)
      const orderStatus = product.sendable ? 1 : 0;

    const { data: createdOrder, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: user.id,
        product_id: product.id,
        status: orderStatus,
        total: product.price,
        created_at: Math.floor(Date.now() / 1000),
      })
      .select("*");

    if (orderError) {
      throw orderError;
    }

    order = createdOrder;

    const { error: productUpdateError } = await supabase
      .from("products")
      .update({ stock: product.stock - 1 })
      .eq("id", product.id);

    if (productUpdateError) {
      throw productUpdateError;
    }
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
    const newCodes = product.codes.filter((code: string) => code !== firstCode);
    const updatedUsedCodes = [...product.used_codes, firstCode!];

    await supabase
      .from("products")
      .update({ codes: newCodes, used_codes: updatedUsedCodes })
      .eq("id", product.id);
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
