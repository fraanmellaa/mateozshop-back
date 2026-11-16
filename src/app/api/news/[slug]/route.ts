import { NextRequest, NextResponse } from "next/server";

import { getPublishedNewsBySlug } from "@/app/utils/news";
import { isNewsSlug } from "@/app/utils/news/schema";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params;
  if (!isNewsSlug(slug)) {
    return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const news = await getPublishedNewsBySlug(slug);
    if (!news) {
      return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
    }
    // body: texto plano; el front lo pinta escapado.
    return NextResponse.json({ success: true, data: news });
  } catch (error) {
    console.error("Error fetching news item:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
