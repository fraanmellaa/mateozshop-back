import { NextRequest, NextResponse } from "next/server";
import {
  updateProduct,
  deleteProduct,
  getProductById,
} from "@/app/utils/products";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const product = await getProductById(id);
    if (!product)
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );

    return NextResponse.json(product);
  } catch (error) {
    console.error("Error getting product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const body = await request.json();
    const {
      name,
      description,
      image,
      price,
      stock,
      sendable,
      codes,
      used_codes,
    } = body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (price !== undefined) updateData.price = parseInt(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (sendable !== undefined) updateData.sendable = Boolean(sendable);
    if (codes !== undefined) updateData.codes = codes;
    if (used_codes !== undefined) updateData.used_codes = used_codes;

    const product = await updateProduct(id, updateData);
    if (!product)
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );

    return NextResponse.json(product);
  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id))
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    await deleteProduct(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
