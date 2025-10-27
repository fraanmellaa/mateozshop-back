import { NextRequest, NextResponse } from "next/server";
import { getGiveaways, createGiveaway } from "@/app/utils/giveaways/admin";

export async function GET() {
  try {
    const giveaways = await getGiveaways();
    return NextResponse.json(giveaways);
  } catch (error) {
    console.error("Error fetching giveaways:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, image, cost, start_at, end_at, sendable, codes } = body;

    if (
      !title ||
      !image ||
      !cost ||
      !start_at ||
      !end_at ||
      sendable === undefined
    ) {
      return NextResponse.json(
        { error: "Todos los campos son requeridos" },
        { status: 400 }
      );
    }

    if (start_at >= end_at) {
      return NextResponse.json(
        { error: "La fecha de inicio debe ser anterior a la fecha de fin" },
        { status: 400 }
      );
    }

    if (sendable && (!codes || !Array.isArray(codes) || codes.length === 0)) {
      return NextResponse.json(
        { error: "Si el sorteo es enviable, debe proporcionar códigos" },
        { status: 400 }
      );
    }

    const giveaway = await createGiveaway({
      title,
      image,
      cost: parseInt(cost),
      start_at: parseInt(start_at),
      end_at: parseInt(end_at),
    });

    return NextResponse.json(giveaway, { status: 201 });
  } catch (error) {
    console.error("Error creating giveaway:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
