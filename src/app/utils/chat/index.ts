"use server";

import { getAppAccessToken } from "@/app/api/utils";

export async function sendKickBotMessage(
  message: string,
  reply_message_id: string
): Promise<void> {
  const endpoint = "https://api.kick.com/public/v1/chat";
  const payload: Record<string, unknown> = {
    content: message,
    reply_to_message_id: reply_message_id,
    type: "bot",
  };

  const authToken = await getAppAccessToken();

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });
}
