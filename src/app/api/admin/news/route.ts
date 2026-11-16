import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { purgeNewsCache } from "@/app/utils/frontendCache";
import { createNews, getAllNews } from "@/app/utils/news";
import { createNewsSchema } from "@/app/utils/news/schema";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const result = await getAllNews();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error fetching news:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const body = await request.json().catch(() => null);
  const parsed = createNewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Datos no válidos" },
      { status: 400 }
    );
  }

  try {
    const news = await createNews(parsed.data);
    await purgeNewsCache().catch(() => null);
    return NextResponse.json({ success: true, data: news }, { status: 201 });
  } catch (error) {
    console.error("Error creating news:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
