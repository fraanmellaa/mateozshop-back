import { NextRequest, NextResponse } from "next/server";
import { getProducts, createProduct } from "@/app/utils/products";

export async function GET() {
  try {
    const products = await getProducts();
    return NextResponse.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, image, price, stock, sendable, codes } = body;

    if (
      !name ||
      !description ||
      !image ||
      price === undefined ||
      stock === undefined
    ) {
      return NextResponse.json(
        { error: "Todos los campos son requeridos" },
        { status: 400 }
      );
    }

    if (sendable && (!codes || !Array.isArray(codes))) {
      return NextResponse.json(
        { error: "Si el producto es enviable, los códigos deben ser un array" },
        { status: 400 }
      );
    }

    const product = await createProduct({
      name,
      description,
      image,
      price: parseInt(price),
      stock: parseInt(stock),
      sendable: Boolean(sendable),
      codes: codes || [],
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
