import { createHash, createHmac, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";

import { derivedSecret, requireEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { HELIX, TWITCH_TOKEN_URL, helixAppFetch } from "@/app/utils/twitch/helix";

export type StreamerPlatform = "kick" | "twitch";

export type SubscriptionStatus = {
  type: string;
  id: string | null;
  status: "active" | "error";
  error: string | null;
  updated_at: number;
};

type ConnectionRow = {
  platform: StreamerPlatform;
  platform_user_id: string;
  platform_username: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  scopes: string | null;
  subscriptions: SubscriptionStatus[];
  subscriptions_checked_at: number | null;
  last_error: string | null;
  connected_at: number;
  updated_at: number;
};

const KICK_AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_API = "https://api.kick.com/public/v1";
const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";

// Kick: leer usuario y canal y suscribirse a eventos por webhook.
const KICK_SCOPES = "user:read channel:read events:subscribe";
const KICK_EVENTS = ["chat.message.sent", "livestream.status.updated"] as const;
// Twitch: leer el chat como el propio canal. Con el token de aplicación, EventSub
// por webhook exige además user:bot (de quien chatea) y channel:bot (del canal).
const TWITCH_SCOPES = "user:read:chat user:bot channel:bot";
const TWITCH_CHAT_EVENT = "channel.chat.message";
const TWITCH_LIVE_EVENTS = ["stream.online", "stream.offline"] as const;

const REFRESH_MARGIN_SECONDS = 10 * 60;
const CHECK_EVERY_SECONDS = 6 * 3600;

const now = () => Math.floor(Date.now() / 1000);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

// ───────────────────────── configuración ─────────────────────────

function kickCreds() {
  return {
    clientId: process.env.KICK_STREAMER_CLIENT_ID || requireEnv("NEXT_PUBLIC_KICK_CLIENT_ID"),
    clientSecret: process.env.KICK_STREAMER_CLIENT_SECRET || requireEnv("KICK_CLIENT_SECRET"),
  };
}

export function streamerRedirectUri(platform: StreamerPlatform) {
  const base = (process.env.STREAMER_OAUTH_REDIRECT_BASE || requireEnv("BACKEND_BASE_URL")).replace(/\/+$/, "");
  return `${base}/api/admin/connections/${platform}/callback`;
}

export function webhookUrl(platform: StreamerPlatform) {
  return `${requireEnv("BACKEND_BASE_URL").replace(/\/+$/, "")}/api/webhooks/${platform}`;
}

export function missingEnv(platform: StreamerPlatform): string[] {
  const names =
    platform === "kick"
      ? ["NEXT_PUBLIC_KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "KICK_BROADCASTER_USER_ID", "BACKEND_BASE_URL"]
      : [
          "TWITCH_CLIENT_ID",
          "TWITCH_CLIENT_SECRET",
          "TWITCH_BROADCASTER_ID",
          "TWITCH_EVENTSUB_SECRET",
          "BACKEND_BASE_URL",
        ];
  return names.filter((name) => !process.env[name]);
}

// ───────────────────────── OAuth del streamer ─────────────────────────

function stateSecret() {
  return new TextEncoder().encode(derivedSecret("streamer-state"));
}

function verifierFor(platform: StreamerPlatform, nonce: string) {
  return createHmac("sha256", derivedSecret("streamer-pkce")).update(`${platform}:${nonce}`).digest("base64url");
}

/** URL de autorización con `state` firmado (10 min). Kick usa PKCE derivado en servidor. */
export async function createStreamerAuthUrl(platform: StreamerPlatform): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const state = await new SignJWT({ platform, nonce, purpose: "streamer-connection" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());

  if (platform === "kick") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: kickCreds().clientId,
      redirect_uri: streamerRedirectUri("kick"),
      scope: KICK_SCOPES,
      code_challenge: createHash("sha256").update(verifierFor("kick", nonce)).digest("base64url"),
      code_challenge_method: "S256",
      state,
    });
    return `${KICK_AUTHORIZE_URL}?${params}`;
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("TWITCH_CLIENT_ID"),
    redirect_uri: streamerRedirectUri("twitch"),
    scope: TWITCH_SCOPES,
    state,
    force_verify: "true",
  });
  return `${TWITCH_AUTHORIZE_URL}?${params}`;
}

async function verifyStreamerState(platform: StreamerPlatform, state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, stateSecret(), { algorithms: ["HS256"] });
    if (payload.platform !== platform || payload.purpose !== "streamer-connection") return null;
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

type Tokens = { access_token: string; refresh_token: string | null; expires_at: number | null; scopes: string | null };

async function requestTokens(url: string, params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);

  const body = await res.json();
  if (typeof body?.access_token !== "string") throw new Error("Token response without access_token");

  const expiresIn = Number(body.expires_in);
  const scope = Array.isArray(body.scope) ? body.scope.join(" ") : typeof body.scope === "string" ? body.scope : null;
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? now() + expiresIn : null,
    scopes: scope,
  };
}

async function fetchIdentity(platform: StreamerPlatform, accessToken: string) {
  if (platform === "kick") {
    const res = await fetch(`${KICK_API}/users`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Kick users request failed (${res.status})`);
    const user = (await res.json())?.data?.[0];
    if (user?.user_id == null) throw new Error("Kick users response without user");
    return { id: String(user.user_id), username: typeof user.name === "string" ? user.name : null };
  }

  const res = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": requireEnv("TWITCH_CLIENT_ID") },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Twitch users request failed (${res.status})`);
  const user = (await res.json())?.data?.[0];
  if (typeof user?.id !== "string") throw new Error("Twitch users response without user");
  return { id: user.id, username: String(user.display_name || user.login) };
}

export class ConnectionError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "ConnectionError";
    this.code = code;
  }
}

/**
 * Cierra el OAuth del streamer: canjea el código, comprueba que la cuenta
 * autorizada es la del canal configurado, guarda los tokens y suscribe los eventos.
 */
export async function completeStreamerConnection(platform: StreamerPlatform, code: string, state: string) {
  const nonce = await verifyStreamerState(platform, state);
  if (!nonce) throw new ConnectionError("INVALID_STATE");

  let tokens: Tokens;
  try {
    tokens =
      platform === "kick"
        ? await requestTokens(KICK_TOKEN_URL, {
            grant_type: "authorization_code",
            client_id: kickCreds().clientId,
            client_secret: kickCreds().clientSecret,
            redirect_uri: streamerRedirectUri("kick"),
            code_verifier: verifierFor("kick", nonce),
            code,
          })
        : await requestTokens(TWITCH_TOKEN_URL, {
            grant_type: "authorization_code",
            client_id: requireEnv("TWITCH_CLIENT_ID"),
            client_secret: requireEnv("TWITCH_CLIENT_SECRET"),
            redirect_uri: streamerRedirectUri("twitch"),
            code,
          });
  } catch (error) {
    console.error(`Streamer ${platform} token exchange failed:`, error);
    throw new ConnectionError("OAUTH_FAILED");
  }

  let identity;
  try {
    identity = await fetchIdentity(platform, tokens.access_token);
  } catch (error) {
    console.error(`Streamer ${platform} identity failed:`, error);
    throw new ConnectionError("OAUTH_FAILED");
  }

  const expected = platform === "kick" ? process.env.KICK_BROADCASTER_USER_ID : process.env.TWITCH_BROADCASTER_ID;
  if (!expected || identity.id !== expected) throw new ConnectionError("WRONG_ACCOUNT");

  const { error } = await getSupabaseAdmin()
    .from("streamer_connections")
    .upsert(
      {
        platform,
        platform_user_id: identity.id,
        platform_username: identity.username,
        ...tokens,
        subscriptions: [],
        subscriptions_checked_at: null,
        last_error: null,
        connected_at: now(),
        updated_at: now(),
      },
      { onConflict: "platform" }
    );
  if (error) throw error;

  await subscribePlatform(platform);
}

// ───────────────────────── lectura y refresco ─────────────────────────

async function getRow(platform: StreamerPlatform): Promise<ConnectionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("streamer_connections")
    .select("*")
    .eq("platform", platform)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? ({ ...row, subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : [] } as ConnectionRow) : null;
}

async function patchRow(platform: StreamerPlatform, values: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin()
    .from("streamer_connections")
    .update({ ...values, updated_at: now() })
    .eq("platform", platform);
  if (error) throw error;
}

/** Access token vigente del streamer (lo renueva si caduca pronto). Lanza si hay que volver a conectar. */
async function getStreamerToken(row: ConnectionRow): Promise<string> {
  if (!row.expires_at || row.expires_at - now() > REFRESH_MARGIN_SECONDS) return row.access_token;
  if (!row.refresh_token) throw new Error("Token caducado y sin refresh_token: vuelve a conectar");

  try {
    const tokens =
      row.platform === "kick"
        ? await requestTokens(KICK_TOKEN_URL, {
            grant_type: "refresh_token",
            client_id: kickCreds().clientId,
            client_secret: kickCreds().clientSecret,
            refresh_token: row.refresh_token,
          })
        : await requestTokens(TWITCH_TOKEN_URL, {
            grant_type: "refresh_token",
            client_id: requireEnv("TWITCH_CLIENT_ID"),
            client_secret: requireEnv("TWITCH_CLIENT_SECRET"),
            refresh_token: row.refresh_token,
          });

    await patchRow(row.platform, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? row.refresh_token,
      expires_at: tokens.expires_at,
      scopes: tokens.scopes ?? row.scopes,
      last_error: null,
    });
    return tokens.access_token;
  } catch (error) {
    await patchRow(row.platform, { last_error: `No se pudo renovar el token: ${errorText(error)}` });
    throw error;
  }
}

// ───────────────────────── suscripciones ─────────────────────────

async function subscribeKick(row: ConnectionRow): Promise<SubscriptionStatus[]> {
  const token = await getStreamerToken(row);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const at = now();
  const broadcaster = Number(row.platform_user_id);

  const listRes = await fetch(`${KICK_API}/events/subscriptions?broadcaster_user_id=${broadcaster}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!listRes.ok) throw new Error(`Kick: no se pudo listar suscripciones (${listRes.status})`);
  const existing: { id: string; event: string }[] = (await listRes.json())?.data ?? [];

  const result: SubscriptionStatus[] = [];
  const missing: string[] = [];
  for (const name of KICK_EVENTS) {
    const found = existing.find((sub) => sub.event === name);
    if (found) result.push({ type: name, id: found.id, status: "active", error: null, updated_at: at });
    else missing.push(name);
  }

  if (missing.length > 0) {
    const res = await fetch(`${KICK_API}/events/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        broadcaster_user_id: broadcaster,
        method: "webhook",
        events: missing.map((name) => ({ name, version: 1 })),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    for (const name of missing) {
      const item = Array.isArray(body?.data) ? body.data.find((d: { name?: string }) => d?.name === name) : null;
      const failed = !res.ok || !item || item.error;
      result.push({
        type: name,
        id: item?.subscription_id ?? null,
        status: failed ? "error" : "active",
        error: failed ? String(item?.error ?? body?.message ?? `HTTP ${res.status}`).slice(0, 200) : null,
        updated_at: at,
      });
    }
  }
  return result;
}

type TwitchSub = {
  id: string;
  status: string;
  type: string;
  condition?: { broadcaster_user_id?: string };
  transport?: { callback?: string };
};

async function subscribeTwitch(row: ConnectionRow): Promise<SubscriptionStatus[]> {
  const broadcaster = row.platform_user_id;
  const callback = webhookUrl("twitch");
  const at = now();

  const listRes = await helixAppFetch("/eventsub/subscriptions");
  if (!listRes.ok) throw new Error(`Twitch: no se pudo listar suscripciones (${listRes.status})`);
  const existing: TwitchSub[] = ((await listRes.json())?.data ?? []).filter(
    (sub: TwitchSub) => sub.condition?.broadcaster_user_id === broadcaster
  );

  const wanted: { type: string; condition: Record<string, string> }[] = [
    { type: TWITCH_CHAT_EVENT, condition: { broadcaster_user_id: broadcaster, user_id: broadcaster } },
    ...TWITCH_LIVE_EVENTS.map((type) => ({ type, condition: { broadcaster_user_id: broadcaster } })),
  ];

  const result: SubscriptionStatus[] = [];
  for (const item of wanted) {
    const found = existing.find(
      (sub) =>
        sub.type === item.type &&
        sub.transport?.callback === callback &&
        (sub.status === "enabled" || sub.status === "webhook_callback_verification_pending")
    );
    if (found) {
      result.push({ type: item.type, id: found.id, status: "active", error: null, updated_at: at });
      continue;
    }

    // Una suscripción antigua en mal estado (fallos, autorización revocada) se borra y se recrea.
    for (const stale of existing.filter((sub) => sub.type === item.type)) {
      await helixAppFetch(`/eventsub/subscriptions?id=${encodeURIComponent(stale.id)}`, { method: "DELETE" }).catch(
        () => undefined
      );
    }

    const res = await helixAppFetch("/eventsub/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        type: item.type,
        version: "1",
        condition: item.condition,
        transport: { method: "webhook", callback, secret: requireEnv("TWITCH_EVENTSUB_SECRET") },
      }),
    });
    const body = await res.json().catch(() => null);
    result.push({
      type: item.type,
      id: res.ok ? (body?.data?.[0]?.id ?? null) : null,
      status: res.ok ? "active" : "error",
      error: res.ok ? null : String(body?.message ?? `HTTP ${res.status}`).slice(0, 200),
      updated_at: at,
    });
  }
  return result;
}

/** Suscribe (o comprueba) los eventos de la plataforma y guarda el estado. Nunca lanza: el error queda guardado. */
export async function subscribePlatform(platform: StreamerPlatform): Promise<void> {
  const row = await getRow(platform);
  if (!row) throw new ConnectionError("NOT_CONNECTED");

  try {
    const subscriptions = platform === "kick" ? await subscribeKick(row) : await subscribeTwitch(row);
    const failed = subscriptions.filter((s) => s.status === "error");
    await patchRow(platform, {
      subscriptions,
      subscriptions_checked_at: now(),
      last_error: failed.length ? failed.map((s) => `${s.type}: ${s.error}`).join(" | ").slice(0, 500) : null,
    });
  } catch (error) {
    console.error(`Subscribing ${platform} events failed:`, error);
    await patchRow(platform, { last_error: errorText(error), subscriptions_checked_at: now() });
  }
}

/** Borra la conexión y, si se puede, las suscripciones. */
export async function disconnectStreamer(platform: StreamerPlatform): Promise<void> {
  const row = await getRow(platform);
  if (!row) return;

  for (const sub of row.subscriptions) {
    if (!sub.id) continue;
    try {
      if (platform === "twitch") {
        await helixAppFetch(`/eventsub/subscriptions?id=${encodeURIComponent(sub.id)}`, { method: "DELETE" });
      } else {
        await fetch(`${KICK_API}/events/subscriptions?id=${encodeURIComponent(sub.id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${await getStreamerToken(row)}` },
          signal: AbortSignal.timeout(8000),
        });
      }
    } catch {
      // Mejor esfuerzo: la conexión se borra igualmente.
    }
  }

  const { error } = await getSupabaseAdmin().from("streamer_connections").delete().eq("platform", platform);
  if (error) throw error;
}

/** Marca una suscripción como revocada por la plataforma (aviso de Twitch). */
export async function markSubscriptionRevoked(platform: StreamerPlatform, type: string, reason: string) {
  const row = await getRow(platform);
  if (!row) return;
  const subscriptions = row.subscriptions.map((s) =>
    s.type === type ? { ...s, status: "error" as const, error: `Revocada: ${reason}`, updated_at: now() } : s
  );
  await patchRow(platform, { subscriptions, last_error: `Suscripción ${type} revocada: ${reason}` });
}

/**
 * Mantenimiento (lo llama syncLiveState cada minuto, es barato): renueva tokens
 * que caducan pronto y revisa/recrea las suscripciones cada pocas horas.
 */
export async function maintainStreamerConnections(): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from("streamer_connections").select("*");
  if (error) throw error;

  for (const raw of data ?? []) {
    const row = { ...raw, subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [] } as ConnectionRow;
    try {
      await getStreamerToken(row);
      const hasError = row.subscriptions.some((s) => s.status === "error");
      const due = !row.subscriptions_checked_at || now() - row.subscriptions_checked_at > CHECK_EVERY_SECONDS;
      // Los errores solo se reintentan al comprobar (no cada minuto).
      if (due || (hasError && now() - (row.subscriptions_checked_at ?? 0) > 30 * 60)) {
        await subscribePlatform(row.platform);
      }
    } catch (err) {
      console.error(`Maintaining ${row.platform} connection failed:`, err);
    }
  }
}

// ───────────────────────── estado para el panel ─────────────────────────

export type ConnectionStatus = {
  platform: StreamerPlatform;
  missing_env: string[];
  connected: boolean;
  username: string | null;
  platform_user_id: string | null;
  connected_at: number | null;
  token_expires_at: number | null;
  scopes: string | null;
  subscriptions: SubscriptionStatus[];
  subscriptions_checked_at: number | null;
  last_error: string | null;
  redirect_uri: string | null;
  webhook_url: string | null;
};

/** Estado de cada conexión, sin tokens. */
export async function listConnectionStatus(): Promise<ConnectionStatus[]> {
  return Promise.all(
    (["kick", "twitch"] as const).map(async (platform) => {
      const missing = missingEnv(platform);
      const row = await getRow(platform);
      const canUrl = !!(process.env.STREAMER_OAUTH_REDIRECT_BASE || process.env.BACKEND_BASE_URL);
      return {
        platform,
        missing_env: missing,
        connected: !!row,
        username: row?.platform_username ?? null,
        platform_user_id: row?.platform_user_id ?? null,
        connected_at: row?.connected_at ?? null,
        token_expires_at: row?.expires_at ?? null,
        scopes: row?.scopes ?? null,
        subscriptions: row?.subscriptions ?? [],
        subscriptions_checked_at: row?.subscriptions_checked_at ?? null,
        last_error: row?.last_error ?? null,
        redirect_uri: canUrl ? streamerRedirectUri(platform) : null,
        webhook_url: process.env.BACKEND_BASE_URL ? webhookUrl(platform) : null,
      };
    })
  );
}
