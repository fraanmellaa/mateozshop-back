import { NextRequest, NextResponse } from "next/server";
import * as Ably from "ably";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ABLY_API_KEY_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const discordId = request.nextUrl.searchParams.get("discord_id");
  if (discordId !== null && !/^\d{1,32}$/.test(discordId)) {
    return NextResponse.json(
      { success: false, error: "INVALID_DISCORD_ID" },
      { status: 400 }
    );
  }

  // Solo suscripción. El canal privado es únicamente el del usuario indicado
  // (el front lo saca de su sesión de servidor), nunca un comodín.
  const capability: Record<string, string[]> = {
    auctions: ["subscribe"],
    "product-*": ["subscribe"],
  };
  if (discordId) {
    capability[`user:${discordId}`] = ["subscribe"];
  }

  const ably = new Ably.Rest(apiKey);
  const tokenRequest = await ably.auth.createTokenRequest({
    capability: JSON.stringify(capability),
    ttl: 1000 * 60 * 30,
  });

  return NextResponse.json(tokenRequest, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
