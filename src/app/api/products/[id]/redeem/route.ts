import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/app/utils/email";
import { redeemProductAtomic } from "@/app/utils/points";
import { pointsErrorResponse } from "@/app/utils/products/pointsErrors";
import { getUserByDiscordId } from "@/app/utils/users";

const bodySchema = z.object({
  discord_id: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_PRODUCT_ID" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  try {
    const user = await getUserByDiscordId(parsed.data.discord_id);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Stock, código, pedido y cobro en una sola transacción.
    const result = await redeemProductAtomic(user.id, productId);

    // A partir de aquí el pedido ya existe: un fallo de email no lo anula.
    try {
      const sent = result.code
        ? await sendEmail(user.email, "PRODUCT_WITH_REWARD", result.code)
        : await sendEmail(user.email, "PRODUCT_NO_REWARD");

      if (!sent) {
        console.error(`Order ${result.order_id}: redeem email could not be sent`);
      }

      if (result.code) {
        // El código ya está guardado en el pedido (lo escribe redeem_product);
        // aquí solo se anota si el email salió, para que el admin pueda reenviarlo.
        const { error } = await getSupabaseAdmin()
          .from("orders")
          .update({ code_email_sent: sent })
          .eq("id", result.order_id);
        if (error) {
          console.error(`Order ${result.order_id}: could not store email status`, error);
        }
      }
    } catch (error) {
      console.error(`Order ${result.order_id}: post-redeem step failed`, error);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          order_id: result.order_id,
          status: result.status,
          total: result.total,
          balance: result.balance,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const response = pointsErrorResponse(error);
    if (response) return response;

    console.error("Error redeeming product:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
