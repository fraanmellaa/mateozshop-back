import { NextResponse } from "next/server";

import { getUserIdByUsername } from "../../utils";
import { updateTotalPoints } from "@/app/utils/users";

export async function POST(request: Request) {
  const body = await request.json();

  const isBotRix = body.sender?.username === "BotRix";

  if (!isBotRix)
    return NextResponse.json(
      {
        message: "Webhook ignored, not from BotRix",
      },
      {
        status: 200,
      }
    );

  const message = body.content;

  const pointsMatch = message.match(/tiene (\d+) puntos/);
  const points = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;

  const usernameMatch = message.match(/@(\w+)/);
  const username = usernameMatch ? usernameMatch[1] : null;

  const userKickId = await getUserIdByUsername(username);

  await updateTotalPoints(userKickId, points);

  return NextResponse.json({
    message: "Webhook received successfully",
    points: points,
  });
}

/*
  {
  message_id: '2263936a-a629-4ca4-94ed-80684a995d61',
  broadcaster: {
    is_anonymous: false,
    user_id: 32508693,
    username: 'FraanMellaa',
    is_verified: false,
    profile_picture: '',
    channel_slug: 'fraanmellaa',
    identity: null
  },
  sender: {
    is_anonymous: false,
    user_id: 1160406,
    username: 'BotRix',
    is_verified: true,
    profile_picture: 'https://files.kick.com/images/user/1160406/profile_image/conversion/e0c36785-23db-401a-bb2a-efe0a1dcfd17-fullsize.webp',
    channel_slug: 'botrix',
    identity: { username_color: '#75FD46', badges: [Array] }
  },
  content: '@FraanMellaa tiene 30 puntos.',
  emotes: null
}

*/
