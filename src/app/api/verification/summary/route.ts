import { NextResponse } from "next/server";

import { VipUnavailableError } from "@/app/utils/points/vip";
import { getShopSettings } from "@/app/utils/shop/settings";
import { vipBidsOpen } from "@/app/utils/shop/schema";
import { countVerifiedUsers } from "@/app/utils/verification";

// Datos públicos de la página de verificación: cuántas cuentas hay verificadas,
// los puntos VIP por minuto de cada tramo y cuándo se abren las pujas VIP.
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

    const now = Math.floor(Date.now() / 1000);
    const open = vipBidsOpen(settings.vipOpensAt, now);
    return NextResponse.json({
      success: true,
      data: {
        available,
        verified,
        rates: [settings.vipPointsPerMinute, settings.vipPointsPerMinuteTwo, settings.vipPointsPerMinuteThree],
        vip_open: open,
        vip_opens_at: !open && settings.vipOpensAt > now ? settings.vipOpensAt : null,
      },
    });
  } catch (error) {
    console.error("Error reading verification summary:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
