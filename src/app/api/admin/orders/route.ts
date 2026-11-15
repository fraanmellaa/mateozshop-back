import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getOrders } from "@/app/utils/orders";

/**
 * Pedidos para el panel. `?view=review` = pendientes de revisión;
 * `?view=deliveries` = pendientes de entregar (ya revisados, si lo requerían).
 */
export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const view = request.nextUrl.searchParams.get("view");
    const orders = await getOrders();

    const result =
      view === "review"
        ? orders.filter((o) => o.needs_review && !o.reviewed && o.status !== 2)
        : view === "deliveries"
          ? orders.filter((o) => o.status === 0 && !(o.needs_review && !o.reviewed))
          : orders;

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
