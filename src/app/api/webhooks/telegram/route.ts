import { NextRequest, NextResponse } from "next/server";

import { safeEqual } from "@/lib/env";
import {
  createFromTelegram,
  updateFromTelegram,
} from "@/app/utils/predictions";

type TelegramPost = {
  message_id?: unknown;
  date?: unknown;
  text?: unknown;
  caption?: unknown;
  chat?: { id?: unknown };
};

const ok = () => NextResponse.json({ ok: true });

/**
 * Webhook de Telegram. Solo acepta peticiones con el secret_token configurado en
 * setWebhook y solo mensajes del canal TELEGRAM_CHANNEL_ID. Lo ignorado devuelve
 * 200 para que Telegram no reintente.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  if (!secret || !channelId) {
    console.error("TELEGRAM_WEBHOOK_SECRET / TELEGRAM_CHANNEL_ID not configured: webhook refused");
    return NextResponse.json(
      { success: false, error: "WEBHOOK_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as {
    channel_post?: TelegramPost;
    edited_channel_post?: TelegramPost;
  } | null;
  if (!update || typeof update !== "object") return ok();

  const isEdit = !update.channel_post && !!update.edited_channel_post;
  const post = update.channel_post ?? update.edited_channel_post;
  if (!post || typeof post !== "object") return ok();

  if (String(post.chat?.id ?? "") !== channelId.trim()) return ok();

  const messageId = post.message_id;
  const rawText = typeof post.text === "string" ? post.text : post.caption;
  const text = typeof rawText === "string" ? rawText.trim().slice(0, 4000) : "";
  if (typeof messageId !== "number" || !Number.isSafeInteger(messageId) || !text) {
    return ok();
  }
  const date =
    typeof post.date === "number" && post.date > 0
      ? Math.floor(post.date)
      : Math.floor(Date.now() / 1000);

  try {
    const input = { messageId, text, date };
    if (isEdit) await updateFromTelegram(input);
    else await createFromTelegram(input);
    return ok();
  } catch (error) {
    console.error("Error processing Telegram update:", error);
    // 500: Telegram reintentará el envío.
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
