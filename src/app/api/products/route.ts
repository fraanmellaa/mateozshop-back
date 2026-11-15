import { NextRequest, NextResponse } from "next/server";

import { getProducts } from "@/app/utils/products";

export async function GET(request: NextRequest) {
  const includeArchived =
    request.nextUrl.searchParams.get("includeArchivedAuctions") === "1";

  try {
    const products = await getProducts({ includeArchived });
    return NextResponse.json({ success: true, result: products }, { status: 200 });
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
