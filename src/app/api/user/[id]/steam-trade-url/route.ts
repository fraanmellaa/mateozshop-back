import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getUserByDiscordId } from "@/app/utils/users";

// https://steamcommunity.com/tradeoffer/new/?partner=<n>&token=<token de 8 caracteres>
const TRADE_URL = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=(\d{1,12})&token=([A-Za-z0-9_-]{8})$/;

const bodySchema = z.object({ url: z.string().max(300) });

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: discordId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const url = parsed.data.url.trim();
  if (url !== "" && !TRADE_URL.test(url)) {
    return NextResponse.json({ success: false, error: "INVALID_TRADE_URL" }, { status: 400 });
  }

  try {
    const user = await getUserByDiscordId(discordId);
    if (!user) {
      return NextResponse.json({ success: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // `url` vacío la borra.
    const { error } = await getSupabaseAdmin()
      .from("users")
      .update({ steam_trade_url: url === "" ? null : url })
      .eq("id", user.id);
    if (error) throw error;

    return NextResponse.json(
      { success: true, data: { steam_trade_url: url === "" ? null : url } },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error saving steam trade url:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
