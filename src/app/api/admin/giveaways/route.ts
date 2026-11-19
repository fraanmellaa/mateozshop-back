import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { getGiveaways, createGiveaway } from "@/app/utils/giveaways/admin";
import { isValidTicketCost } from "@/app/utils/giveaways/tickets";

export async function GET() {
  if (!(await requireAdmin())) return adminUnauthorized();

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
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const body = await request.json();
    const { title, image, cost, start_at, end_at, sendable, codes, rules } = body;

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

    // El ticket cuesta un número entero de puntos, al menos 1: con un coste
    // negativo o con decimales los tickets saldrían gratis o mal cobrados.
    if (!isValidTicketCost(cost)) {
      return NextResponse.json(
        { error: "El coste del ticket debe ser un número entero de puntos, de 1 en adelante" },
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

    if (rules !== undefined && rules !== null && (typeof rules !== "string" || rules.length > 10000)) {
      return NextResponse.json(
        { error: "Las bases deben ser un texto de hasta 10000 caracteres" },
        { status: 400 }
      );
    }

    const giveaway = await createGiveaway({
      title,
      image,
      cost: parseInt(cost),
      start_at: parseInt(start_at),
      end_at: parseInt(end_at),
      sendable: Boolean(sendable),
      rules: typeof rules === "string" && rules.trim() ? rules.trim() : null,
      codes: sendable
        ? codes.map((code: unknown) => String(code).trim()).filter(Boolean)
        : [],
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
