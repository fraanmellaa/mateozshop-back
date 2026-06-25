import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { signExtensionToken, validateExtensionKey } from "@/app/utils/extensionAuth";
import { createUser, getUserByDiscordId } from "@/app/utils/users";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

const bodySchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
};

function buildDiscordAvatarUrl(discordUser: DiscordUser) {
  if (discordUser.avatar) {
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`;
  }
  return "https://cdn.discordapp.com/embed/avatars/0.png";
}

async function exchangeCodeForToken(code: string, redirectUri: string) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("DISCORD_OAUTH_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!tokenRes.ok) {
    throw new Error("DISCORD_TOKEN_EXCHANGE_FAILED");
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("DISCORD_TOKEN_MISSING");
  }

  return tokenJson.access_token;
}

async function fetchDiscordMe(accessToken: string) {
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!meRes.ok) {
    throw new Error("DISCORD_ME_FAILED");
  }

  const me = (await meRes.json()) as DiscordUser;
  if (!me.id || !me.username) {
    throw new Error("DISCORD_ME_INVALID");
  }

  if (!me.email) {
    throw new Error("DISCORD_EMAIL_REQUIRED");
  }

  return me;
}

async function upsertUserFromDiscord(me: DiscordUser) {
  const displayName = me.global_name || me.username;
  const avatar = buildDiscordAvatarUrl(me);

  let user = await getUserByDiscordId(me.id);

  if (!user) {
    await createUser({
      name: displayName,
      user_id: me.id,
      profile_picture: avatar,
      email: me.email || `${me.id}@discord.local`,
    });

    user = await getUserByDiscordId(me.id);
  } else {
    const { data: updated, error } = await supabase
      .from("users")
      .update({
        username: displayName,
        image: avatar,
        email: me.email || user.email,
      })
      .eq("discord_id", me.id)
      .select("*");

    if (error) {
      throw error;
    }

    if (updated.length > 0) {
      const row = updated[0];
      user = {
        ...row,
        actual_points: row.total_points - row.used_points,
        created_at: new Date(row.created_at * 1000).toISOString(),
      };
    }
  }

  return user;
}

export async function POST(request: NextRequest) {
  const keyError = validateExtensionKey(request);
  if (keyError) return keyError;

  let body;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "INVALID_REQUEST_BODY", details: error.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  try {
    const accessToken = await exchangeCodeForToken(body.code, body.redirectUri);
    const discordMe = await fetchDiscordMe(accessToken);
    const user = await upsertUserFromDiscord(discordMe);

    if (!user) {
      return NextResponse.json({ error: "USER_UPSERT_FAILED" }, { status: 500 });
    }

    const extensionToken = await signExtensionToken(discordMe.id);

    return NextResponse.json(
      {
        success: true,
        data: {
          token: extensionToken,
          user: {
            discord_id: user.discord_id,
            username: user.username,
            image: user.image,
            points: user.actual_points,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
