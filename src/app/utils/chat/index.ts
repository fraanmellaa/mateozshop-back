"use server";

import { getAccessToken } from "@/app/api/utils";

export async function sendKickBotMessage(message: string): Promise<void> {
  const endpoint = "https://api.kick.com/public/v1/chat";
  const payload: Record<string, unknown> = {
    content: message,
    type: "bot",
  };

  const authToken = await getAccessToken();

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });
}
