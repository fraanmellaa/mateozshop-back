import { NextResponse } from "next/server";
import * as Ably from "ably";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ABLY_API_KEY_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const ably = new Ably.Rest(apiKey);

  // Frontend clients only need read access to live auction updates.
  const capability = JSON.stringify({
    auctions: ["subscribe"],
    "product-*": ["subscribe"],
    "user-*": ["subscribe"],
  });

  const tokenRequest = await ably.auth.createTokenRequest({
    capability,
    ttl: 1000 * 60 * 30,
  });

  return NextResponse.json(tokenRequest, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
