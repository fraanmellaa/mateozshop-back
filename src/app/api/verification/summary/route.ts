import { NextResponse } from "next/server";

import { VipUnavailableError } from "@/app/utils/points/vip";
import { getShopSettings } from "@/app/utils/shop/settings";
import { getProducts } from "@/app/utils/products";
import { countVerifiedUsers } from "@/app/utils/verification";

// Datos públicos de la página de verificación: cuántas cuentas hay verificadas,
// los puntos VIP por minuto de cada tramo y cuándo se abren las pujas VIP. Cada
// premio VIP tiene su propia fecha (migración 0039): `vip_open` dice si alguno
// se puede pujar ya y `vip_opens_at` es la primera apertura que queda por llegar.
export async function GET() {
  try {
    const settings = await getShopSettings();
    let verified = 0;
    let available = true;
    try {
      verified = await countVerifiedUsers();
    } catch (error) {
      if (!(error instanceof VipUnavailableError)) throw error;
      available = false; // falta la migración 0032
    }

    const vipProducts = (await getProducts().catch(() => [])).filter(
      (product) => product.currency === "vip" && product.stock > 0
    );
    const open = vipProducts.some((product) => product.open);
    const upcoming = vipProducts
      .map((product) => product.opens_at)
      .filter((value): value is number => typeof value === "number");
    return NextResponse.json({
      success: true,
      data: {
        available,
        verified,
        rates: [settings.vipPointsPerMinute, settings.vipPointsPerMinuteTwo, settings.vipPointsPerMinuteThree],
        vip_open: open,
        vip_opens_at: !open && upcoming.length > 0 ? Math.min(...upcoming) : null,
      },
    });
  } catch (error) {
    console.error("Error reading verification summary:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
