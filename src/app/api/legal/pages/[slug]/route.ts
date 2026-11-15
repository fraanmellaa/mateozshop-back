import { NextRequest, NextResponse } from "next/server";

import { getPublicLegalPage, isLegalSlug } from "@/app/utils/legal";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params;
  if (!isLegalSlug(slug)) {
    return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const page = await getPublicLegalPage(slug);
    if (!page) {
      return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
    }
    // body: texto plano; el front lo pinta escapado.
    return NextResponse.json({ success: true, data: page });
  } catch (error) {
    console.error("Error fetching legal page:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
