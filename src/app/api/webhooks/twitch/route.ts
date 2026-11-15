import { createHmac, timingSafeEqual } from "crypto";
import { after, NextRequest, NextResponse } from "next/server";

import { processChatMessage, type ChatMessage } from "@/app/utils/chat/process";
import { grantRain } from "@/app/utils/economy/rain";
import { syncLiveState } from "@/app/utils/live";
import { markSubscriptionRevoked } from "@/app/utils/live/connections";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_MS = 5 * 60_000;

const ok = () => NextResponse.json({ success: true });

type TwitchBadge = { set_id?: string };
type TwitchPayload = {
  challenge?: string;
  subscription?: { type?: string; status?: string };
  event?: {
    broadcaster_user_id?: string;
    chatter_user_id?: string;
    chatter_user_name?: string;
    chatter_user_login?: string;
    message?: { text?: string };
    message_type?: string;
    badges?: TwitchBadge[];
  };
};

function validSignature(secret: string, id: string, timestamp: string, rawBody: string, signature: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(id + timestamp + rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  const id = request.headers.get("twitch-eventsub-message-id");
  const timestamp = request.headers.get("twitch-eventsub-message-timestamp");
  const signature = request.headers.get("twitch-eventsub-message-signature");
  const type = request.headers.get("twitch-eventsub-message-type");

  // Falla en cerrado: sin secreto configurado no se acepta nada.
  if (!secret || !id || !timestamp || !signature || !validSignature(secret, id, timestamp, rawBody, signature)) {
    return NextResponse.json({ success: false, error: "INVALID_SIGNATURE" }, { status: 403 });
  }

  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_AGE_MS) {
    return NextResponse.json({ success: false, error: "STALE_MESSAGE" }, { status: 400 });
  }

  let payload: TwitchPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  if (type === "webhook_callback_verification") {
    if (typeof payload.challenge !== "string") {
      return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
    }
    return new Response(payload.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  try {
    const { data: fresh, error } = await getSupabaseAdmin().rpc("claim_webhook_event", {
      p_platform: "twitch",
      p_event_id: id,
    });
    if (error) throw error;
    if (fresh !== true) return ok();

    if (type === "revocation") {
      await markSubscriptionRevoked(
        "twitch",
        payload.subscription?.type ?? "unknown",
        payload.subscription?.status ?? "revoked"
      );
      return ok();
    }

    if (type !== "notification") return ok();

    const subscriptionType = payload.subscription?.type;
    if (subscriptionType === "stream.online" || subscriptionType === "stream.offline") {
      after(() => syncLiveState().catch((e) => console.error("Live sync from Twitch webhook failed:", e)));
      return ok();
    }

    if (subscriptionType !== "channel.chat.message") return ok();

    const event = payload.event;
    if (!event?.chatter_user_id || typeof event.message?.text !== "string") return ok();

    const badges = event.badges ?? [];
    const message: ChatMessage = {
      platform: "twitch",
      messageId: id,
      chatterId: event.chatter_user_id,
      chatterName: event.chatter_user_name || event.chatter_user_login || "",
      text: event.message.text,
      isStreamer:
        event.chatter_user_id === event.broadcaster_user_id || badges.some((b) => b?.set_id === "broadcaster"),
      isModerator: badges.some((b) => b?.set_id === "moderator"),
    };

    const outcome = await processChatMessage(message);
    if (outcome.command) {
      const command = outcome.command;
      after(async () => {
        try {
          const result = await grantRain({
            kind: command,
            issuer: { platform: "twitch", platformUserId: message.chatterId },
          });
          if (!result.ok) console.warn(`Twitch !${command} not granted:`, result.reason);
        } catch (e) {
          console.error(`Twitch !${command} failed:`, e);
        }
      });
    }
  } catch (error) {
    console.error("Twitch webhook processing failed:", error);
  }

  return ok();
}
