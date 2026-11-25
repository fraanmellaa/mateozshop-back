import { after, NextRequest, NextResponse } from "next/server";

import { processChatMessage, type ChatMessage } from "@/app/utils/chat/process";
import { grantRain } from "@/app/utils/economy/rain";
import { verifyKickSignature } from "@/app/utils/kick/webhook";
import { syncLiveState } from "@/app/utils/live";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_MS = 5 * 60_000;

const ok = () => NextResponse.json({ success: true });

type KickBadge = { type?: string };
type KickChatEvent = {
  message_id?: string;
  broadcaster?: { user_id?: number | string };
  sender?: {
    user_id?: number | string;
    username?: string;
    identity?: { badges?: KickBadge[] };
  };
  content?: string;
};

export async function POST(request: NextRequest) {
  // El cuerpo en bruto es lo que firma Kick: no se re-serializa.
  const rawBody = await request.text();

  const messageId = request.headers.get("kick-event-message-id");
  const timestamp = request.headers.get("kick-event-message-timestamp");

  const valid = await verifyKickSignature({
    messageId,
    timestamp,
    signature: request.headers.get("kick-event-signature"),
    rawBody,
  });
  if (!valid || !messageId || !timestamp) {
    return NextResponse.json({ success: false, error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_AGE_MS) {
    return NextResponse.json({ success: false, error: "STALE_MESSAGE" }, { status: 400 });
  }

  try {
    const { data: fresh, error } = await getSupabaseAdmin().rpc("claim_webhook_event", {
      p_platform: "kick",
      p_event_id: messageId,
    });
    if (error) throw error;
    if (fresh !== true) return ok();

    const type = request.headers.get("kick-event-type");

    if (type === "livestream.status.updated") {
      after(() => syncLiveState().catch((e) => console.error("Live sync from Kick webhook failed:", e)));
      return ok();
    }

    if (type !== "chat.message.sent") return ok();

    const event = JSON.parse(rawBody) as KickChatEvent;
    // Kick firma con la misma clave los avisos de todas las apps: cualquiera
    // puede apuntar la suya aquí con el chat de su propio canal. Solo cuenta
    // el chat del canal configurado; el resto se descarta.
    const ownChannel = process.env.KICK_BROADCASTER_USER_ID?.trim();
    if (!ownChannel || String(event.broadcaster?.user_id ?? "") !== ownChannel) return ok();

    const senderId = event.sender?.user_id;
    if (senderId == null || typeof event.content !== "string") return ok();

    const isStreamer =
      event.broadcaster?.user_id != null && String(event.broadcaster.user_id) === String(senderId);
    const badges = event.sender?.identity?.badges ?? [];

    const message: ChatMessage = {
      platform: "kick",
      messageId,
      chatterId: String(senderId),
      chatterName: event.sender?.username ?? "",
      text: event.content,
      isStreamer,
      isModerator: badges.some((b) => b?.type === "moderator" || b?.type === "broadcaster"),
    };

    const outcome = await processChatMessage(message);
    if (outcome.command) {
      const command = outcome.command;
      after(async () => {
        try {
          const result = await grantRain({
            kind: command,
            issuer: { platform: "kick", platformUserId: message.chatterId },
          });
          if (!result.ok) console.warn(`Kick !${command} not granted:`, result.reason);
        } catch (e) {
          console.error(`Kick !${command} failed:`, e);
        }
      });
    }
  } catch (error) {
    // La firma era válida: se responde 200 igualmente para que Kick no reintente en bucle.
    console.error("Kick webhook processing failed:", error);
  }

  return ok();
}
