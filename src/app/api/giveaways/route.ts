import { getGiveaways } from "@/app/utils/giveaways";
import { NextResponse } from "next/server";

export async function GET() {
  const giveaways = await getGiveaways();

  const tempGiveaways = {
    actual: [],
    past: [],
  };

  for (let i = 0; i < 10; i++) {
    tempGiveaways.actual.push({
      ...giveaways.actual[0],
      id: i + 1,
    });
  }

  for (let i = 0; i < 4; i++) {
    tempGiveaways.past.push({
      ...giveaways.actual[0],
      id: i + 1,
    });
  }

  return NextResponse.json(
    {
      success: true,
      result: tempGiveaways ?? [],
    },
    {
      status: 200,
    }
  );
}
