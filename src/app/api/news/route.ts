import { NextRequest, NextResponse } from "next/server";

import { getPublishedNews } from "@/app/utils/news";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("page");
  const page = raw === null ? 1 : /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  if (page < 1) {
    return NextResponse.json(
      { success: false, error: "INVALID_PAGE" },
      { status: 400 }
    );
  }

  try {
    const data = await getPublishedNews(page);
    return NextResponse.json({ success: true, ...data }, { status: 200 });
  } catch (error) {
    console.error("Error fetching news:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
