import { NextRequest, NextResponse } from "next/server";

import { getActiveBonuses } from "@/app/utils/bonuses";

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country");
  if (country !== null && !/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json(
      { success: false, error: "INVALID_COUNTRY" },
      { status: 400 }
    );
  }

  try {
    const result = await getActiveBonuses(country);
    return NextResponse.json({ success: true, result }, { status: 200 });
  } catch (error) {
    console.error("Error fetching bonuses:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
