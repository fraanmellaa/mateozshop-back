import { getOrderById } from "@/app/utils/orders";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  if (isNaN(parseInt(id))) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid order ID",
      },
      {
        status: 400,
      }
    );
  }

  const order = await getOrderById(parseInt(id));

  if (!order) {
    return NextResponse.json(
      {
        success: false,
        error: "Order not found",
      },
      {
        status: 404,
      }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: order,
    },
    {
      status: 200,
    }
  );
}
