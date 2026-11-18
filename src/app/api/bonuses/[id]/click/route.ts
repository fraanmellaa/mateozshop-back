import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isMissingFunction } from "@/app/utils/products/currency";

// Suma un clic en «Conseguir bono» (migración 0033). Solo se guarda el número
// por bono y día: nada de quién hace clic. La web lo llama en segundo plano,
// así que nunca devuelve error al usuario.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bonusId = Number(id);
  if (!Number.isInteger(bonusId) || bonusId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_BONUS_ID" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("bonus_click", { p_bonus_id: bonusId });
  if (error) {
    // Sin la migración 0033 no hay contador: no es un fallo para quien hace clic.
    if (!isMissingFunction(error, "bonus_click")) console.error("Error counting bonus click:", error);
    return NextResponse.json({ success: true, data: { counted: false } });
  }
  return NextResponse.json({ success: true, data: { counted: data === true } });
}
