import { getProducts } from "@/app/utils/products";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const includeArchivedAuctions =
    request.nextUrl.searchParams.get("includeArchivedAuctions") === "1";
  const onlyActiveAuctions =
    request.nextUrl.searchParams.get("onlyActiveAuctions") === "1";

  const products = await getProducts({
    includeArchivedAuctions,
    onlyActiveAuctions,
  });

  return NextResponse.json(
    {
      success: true,
      result: products,
    },
    {
      status: 200,
    }
  );
}
