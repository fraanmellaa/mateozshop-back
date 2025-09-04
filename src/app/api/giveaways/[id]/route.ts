import { getGiveawayById } from "@/app/utils/giveaways";
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
        error: "Invalid giveaway ID",
      },
      {
        status: 400,
      }
    );
  }

  const giveaway = await getGiveawayById(parseInt(id));

  if (!giveaway)
    return NextResponse.json(
      {
        success: false,
        error: "Giveaway not found",
      },
      {
        status: 404,
      }
    );

  return NextResponse.json(
    {
      success: true,
      result: giveaway,
    },
    {
      status: 200,
    }
  );
}
