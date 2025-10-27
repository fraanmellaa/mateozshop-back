import { getGiveaways } from "@/app/utils/giveaways";
import { NextResponse } from "next/server";

export async function GET() {
  const giveaways = await getGiveaways();

  return NextResponse.json(
    {
      success: true,
      result: giveaways ?? [],
    },
    {
      status: 200,
    }
  );
}
