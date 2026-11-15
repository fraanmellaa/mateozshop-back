import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { createProduct, getAdminProducts } from "@/app/utils/products";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const products = await getAdminProducts();
    return NextResponse.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  image: z.string().trim().url().max(2000),
  price: z.coerce.number().int().min(1).max(2_000_000_000),
  stock: z.coerce.number().int().min(1).max(100_000),
  value_eur: z
    .union([z.literal(""), z.null(), z.coerce.number().min(0).max(1_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  delivery_type: z.enum(["code", "trade", "dm"]),
  requires_trade_link: z.boolean().optional(),
  codes: z.array(z.string().trim().min(1).max(500)).max(10_000).optional(),
});

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos no válidos: revisa nombre, imagen, puja mínima (≥ 1), stock (≥ 1) y valor en €" },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const product = await createProduct({
      ...body,
      // Las skins por intercambio de Steam necesitan el enlace del ganador.
      requires_trade_link: body.delivery_type === "trade" ? true : Boolean(body.requires_trade_link),
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
