import { NextResponse } from "next/server";
import { getAppAccessToken } from "../../utils";

export async function GET() {
  const apiToken = await getAppAccessToken();

  const res = await fetch(
    `https://api.kick.com/public/v1/channels?broadcaster_user_id=1173997`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json({
      success: false,
      error: "Failed to fetch channels",
    });
  }

  const data = await res.json();
  const mateozData = data[0];

  return NextResponse.json({
    success: true,
    result: mateozData?.stream?.is_live ?? false,
  });
}
