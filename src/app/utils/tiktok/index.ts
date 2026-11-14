import jwt from "jsonwebtoken";
import { createHash, createHmac, randomBytes } from "crypto";

import { derivedSecret } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const TIKTOK_OAUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_OPEN_API_BASE = "https://open.tiktokapis.com";
const REQUIRED_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
] as const;

// La Display API admite como máximo 20 vídeos por petición.
const TIKTOK_VIDEO_BATCH = 20;
// Refrescos consecutivos sin que TikTok devuelva el vídeo antes de darlo por
// borrado/privado.
export const TIKTOK_VIDEO_MAX_REFRESH_FAILURES = 3;
export const TIKTOK_MANUAL_REFRESH_COOLDOWN_SECONDS = 60;
const REFRESH_USER_CONCURRENCY = 4;
const TIKTOK_REQUEST_TIMEOUT_MS = 10_000;

// Estados en los que una leaderboard todavía no tiene snapshot final.
const OPEN_LEADERBOARD_STATUSES = ["scheduled", "active", "finalizing"];

type TikTokTokenResponse = {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  log_id?: string;
};

type TikTokApiErrorBody = {
  code?: string;
  message?: string;
  log_id?: string;
};

type TikTokUserInfoResponse = {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
      username?: string;
      profile_deep_link?: string;
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  };
  error?: TikTokApiErrorBody;
};

export type TikTokApiVideo = {
  id?: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  embed_link?: string;
  create_time?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
};

type TikTokVideoListResponse = {
  data?: {
    videos?: TikTokApiVideo[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: TikTokApiErrorBody;
};

export type TikTokAccountRow = {
  id: number;
  user_id: number;
  open_id: string;
  union_id: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  profile_deep_link: string | null;
  scope: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: number;
  refresh_token_expires_at: number;
  created_at: number;
  last_synced_at: number | null;
  needs_relink?: boolean | null;
};

export type TikTokVideoRow = {
  id: number;
  user_id: number;
  video_id: string;
  title: string;
  cover_image_url: string | null;
  share_url: string | null;
  like_count: number;
  view_count: number;
  comment_count: number;
  share_count: number;
  is_banned: boolean;
  created_at: number;
  updated_at: number;
  associated_at: number;
  leaderboard_id: number | null;
  last_refreshed_at: number | null;
  refresh_failures: number;
  unavailable_at: number | null;
  tiktok_open_id: string | null;
};

/** Error devuelto por TikTok (o por la red al hablar con TikTok). */
export class TikTokApiError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message?: string, httpStatus = 0) {
    super(message || code);
    this.name = "TikTokApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** La cuenta vinculada ya no tiene tokens válidos: hay que volver a vincular. */
export class TikTokRelinkRequiredError extends Error {
  constructor() {
    super("TIKTOK_RELINK_REQUIRED");
    this.name = "TikTokRelinkRequiredError";
  }
}

/** Error de negocio con código estable para las rutas. */
export class TikTokRuleError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "TikTokRuleError";
    this.code = code;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );

  return results;
}

function requireTikTokCredentials() {
  const clientKey = (
    process.env.TIKTOK_CLIENT_API_KEY || process.env.TIKTOK_CLIENT_KEY || ""
  ).trim();
  const clientSecret = (
    process.env.TIKTOK_CLIENT_API_SECRET || process.env.TIKTOK_CLIENT_SECRET || ""
  ).trim();

  if (!clientKey || !clientSecret) {
    const missing: string[] = [];
    if (!clientKey) {
      missing.push("TIKTOK_CLIENT_API_KEY");
    }
    if (!clientSecret) {
      missing.push("TIKTOK_CLIENT_API_SECRET");
    }

    throw new Error(
      `MISSING_TIKTOK_CREDENTIALS: ${missing.join(", ")}`
    );
  }

  return { clientKey, clientSecret };
}

export function getRequiredTikTokScopes() {
  return [...REQUIRED_SCOPES];
}

export function getTikTokAuthUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}) {
  const { clientKey } = requireTikTokCredentials();

  const scopes =
    params.scopes && params.scopes.length > 0
      ? params.scopes.join(",")
      : REQUIRED_SCOPES.join(",");

  const url = new URL(TIKTOK_OAUTH_BASE);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

async function requestTikTokTokens(body: URLSearchParams, fallbackCode: string) {
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_OPEN_API_BASE}/v2/oauth/token/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIKTOK_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TikTokApiError("TIKTOK_NETWORK_ERROR");
  }

  const data = (await response.json().catch(() => null)) as TikTokTokenResponse | null;

  if (!response.ok || !data?.access_token) {
    throw new TikTokApiError(
      data?.error || fallbackCode,
      data?.error_description || data?.error || fallbackCode,
      response.status
    );
  }

  return data;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  return requestTikTokTokens(
    new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
    "TIKTOK_TOKEN_ERROR"
  );
}

export async function refreshTikTokTokens(refreshToken: string) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  return requestTikTokTokens(
    new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    "TIKTOK_REFRESH_ERROR"
  );
}

export async function getUserTikTokConnection(
  userId: number
): Promise<TikTokAccountRow | null> {
  const { data: results, error } = await getSupabaseAdmin()
    .from("user_tiktok_accounts")
    .select("*")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw error;
  }

  return (results?.[0] as TikTokAccountRow | undefined) ?? null;
}

/**
 * Los vídeos de leaderboards sin snapshot final (y los sueltos) dejan de contar
 * cuando el usuario desvincula o cambia de cuenta de TikTok: si no, podría
 * meter vídeos de varias cuentas alternando vinculaciones.
 */
async function removeUserVideosFromOpenLeaderboards(userId: number) {
  const supabase = getSupabaseAdmin();

  const { data: openBoards, error: boardsError } = await supabase
    .from("tiktok_leaderboards")
    .select("id")
    .in("status", OPEN_LEADERBOARD_STATUSES);

  if (boardsError) throw boardsError;

  const { error: looseError } = await supabase
    .from("user_tiktok_videos")
    .delete()
    .eq("user_id", userId)
    .is("leaderboard_id", null);

  if (looseError) throw looseError;

  const openIds = (openBoards || []).map((board) => board.id);
  if (openIds.length === 0) return;

  const { error: openError } = await supabase
    .from("user_tiktok_videos")
    .delete()
    .eq("user_id", userId)
    .in("leaderboard_id", openIds);

  if (openError) throw openError;
}

export async function saveTikTokConnection(params: {
  userId: number;
  tokens: TikTokTokenResponse;
  profile: NonNullable<TikTokUserInfoResponse["data"]>["user"];
}) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();

  const { data: sameAccount, error: sameAccountError } = await supabase
    .from("user_tiktok_accounts")
    .select("user_id")
    .eq("open_id", params.tokens.open_id)
    .limit(1);

  if (sameAccountError) throw sameAccountError;

  if (sameAccount?.[0] && sameAccount[0].user_id !== params.userId) {
    throw new TikTokRuleError("TIKTOK_ACCOUNT_ALREADY_LINKED");
  }

  const previous = await getUserTikTokConnection(params.userId);
  if (previous && previous.open_id !== params.tokens.open_id) {
    await removeUserVideosFromOpenLeaderboards(params.userId);
  }

  const payload = {
    user_id: params.userId,
    open_id: params.tokens.open_id,
    union_id: params.profile?.union_id || null,
    display_name: params.profile?.display_name || null,
    username: params.profile?.username || null,
    avatar_url: params.profile?.avatar_url || null,
    profile_deep_link: params.profile?.profile_deep_link || null,
    scope: params.tokens.scope,
    access_token: params.tokens.access_token,
    refresh_token: params.tokens.refresh_token,
    access_token_expires_at: now + params.tokens.expires_in,
    refresh_token_expires_at: now + params.tokens.refresh_expires_in,
    needs_relink: false,
    created_at: previous?.created_at ?? now,
    updated_at: now,
  };

  const { data: created, error } = await supabase
    .from("user_tiktok_accounts")
    .upsert(payload, { onConflict: "user_id" })
    .select("*");

  if (error) {
    // Carrera con otra vinculación de la misma cuenta de TikTok.
    if (error.code === "23505") {
      throw new TikTokRuleError("TIKTOK_ACCOUNT_ALREADY_LINKED");
    }
    throw error;
  }

  return created?.[0] ?? null;
}

async function markTikTokAccountNeedsRelink(userId: number) {
  const { error } = await getSupabaseAdmin()
    .from("user_tiktok_accounts")
    .update({ needs_relink: true, updated_at: nowSeconds() })
    .eq("user_id", userId);

  if (error) {
    console.error("No se pudo marcar la cuenta de TikTok para revincular:", error);
  }
}

/**
 * Devuelve un access token válido para la cuenta, refrescándolo si ha caducado
 * (o si `force`). Actualiza `account` con los tokens nuevos. Lanza
 * `TikTokRelinkRequiredError` si el refresh token ya no sirve.
 */
export async function getValidAccessToken(
  account: TikTokAccountRow,
  options: { force?: boolean } = {}
): Promise<string> {
  const now = nowSeconds();

  if (account.needs_relink) {
    throw new TikTokRelinkRequiredError();
  }

  if (!options.force && account.access_token_expires_at > now + 120) {
    return account.access_token;
  }

  if (account.refresh_token_expires_at <= now) {
    await markTikTokAccountNeedsRelink(account.user_id);
    account.needs_relink = true;
    throw new TikTokRelinkRequiredError();
  }

  let refreshed: TikTokTokenResponse;
  try {
    refreshed = await refreshTikTokTokens(account.refresh_token);
  } catch (error) {
    if (error instanceof TikTokApiError && error.code === "invalid_grant") {
      // Otra petición pudo refrescar a la vez y rotar el refresh token: si en
      // BD hay tokens distintos y vigentes, valen esos.
      const latest = await getUserTikTokConnection(account.user_id);
      if (
        latest &&
        latest.refresh_token !== account.refresh_token &&
        latest.access_token_expires_at > now + 60
      ) {
        Object.assign(account, latest);
        return latest.access_token;
      }

      await markTikTokAccountNeedsRelink(account.user_id);
      account.needs_relink = true;
      throw new TikTokRelinkRequiredError();
    }
    throw error;
  }

  const update = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || account.refresh_token,
    scope: refreshed.scope || account.scope,
    access_token_expires_at: now + refreshed.expires_in,
    refresh_token_expires_at: refreshed.refresh_expires_in
      ? now + refreshed.refresh_expires_in
      : account.refresh_token_expires_at,
    updated_at: now,
  };

  const { error } = await getSupabaseAdmin()
    .from("user_tiktok_accounts")
    .update(update)
    .eq("user_id", account.user_id);

  if (error) {
    throw error;
  }

  Object.assign(account, update);
  return refreshed.access_token;
}

/** Ejecuta una llamada a la Display API con el token de la cuenta. */
async function withAccountToken<T>(
  account: TikTokAccountRow,
  call: (accessToken: string) => Promise<T>
): Promise<T> {
  const accessToken = await getValidAccessToken(account);

  try {
    return await call(accessToken);
  } catch (error) {
    if (error instanceof TikTokApiError && error.code === "access_token_invalid") {
      const fresh = await getValidAccessToken(account, { force: true });
      return call(fresh);
    }

    if (error instanceof TikTokApiError && error.code === "scope_not_authorized") {
      await markTikTokAccountNeedsRelink(account.user_id);
      account.needs_relink = true;
      throw new TikTokRelinkRequiredError();
    }

    throw error;
  }
}

async function tiktokApiRequest<T extends { error?: TikTokApiErrorBody }>(
  path: string,
  accessToken: string,
  init: { method: "GET" | "POST"; body?: unknown },
  fallbackCode: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_OPEN_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(TIKTOK_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TikTokApiError("TIKTOK_NETWORK_ERROR");
  }

  const data = (await response.json().catch(() => null)) as T | null;
  const code = data?.error?.code;

  if (!response.ok || !data || code !== "ok") {
    throw new TikTokApiError(
      code && code !== "ok" ? code : fallbackCode,
      data?.error?.message || fallbackCode,
      response.status
    );
  }

  return data;
}

export async function fetchTikTokUserInfo(accessToken: string) {
  const fields = [
    "open_id",
    "union_id",
    "avatar_url",
    "display_name",
    "username",
    "profile_deep_link",
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");

  const data = await tiktokApiRequest<TikTokUserInfoResponse>(
    `/v2/user/info/?fields=${encodeURIComponent(fields)}`,
    accessToken,
    { method: "GET" },
    "TIKTOK_USER_INFO_ERROR"
  );

  if (!data.data?.user) {
    throw new TikTokApiError("TIKTOK_USER_INFO_ERROR");
  }

  return data.data.user;
}

/** Perfil en vivo de la cuenta vinculada, refrescando el token si hace falta. */
export async function fetchTikTokProfileForAccount(account: TikTokAccountRow) {
  return withAccountToken(account, (accessToken) => fetchTikTokUserInfo(accessToken));
}

const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "duration",
  "cover_image_url",
  "share_url",
  "embed_link",
  "create_time",
  "like_count",
  "comment_count",
  "share_count",
  "view_count",
].join(",");

/**
 * Display API `/v2/video/query/`: devuelve solo los vídeos que pertenecen a la
 * cuenta del token, así que sirve a la vez para verificar propiedad y leer
 * contadores. Un id ausente en la respuesta = el vídeo no existe, es privado o
 * no es de esa cuenta.
 */
async function queryTikTokVideosByIds(accessToken: string, videoIds: string[]) {
  const found = new Map<string, TikTokApiVideo>();

  for (let i = 0; i < videoIds.length; i += TIKTOK_VIDEO_BATCH) {
    const data = await tiktokApiRequest<TikTokVideoListResponse>(
      `/v2/video/query/?fields=${encodeURIComponent(VIDEO_FIELDS)}`,
      accessToken,
      {
        method: "POST",
        body: { filters: { video_ids: videoIds.slice(i, i + TIKTOK_VIDEO_BATCH) } },
      },
      "TIKTOK_VIDEO_QUERY_ERROR"
    );

    for (const video of data.data?.videos || []) {
      if (video.id) found.set(String(video.id), video);
    }
  }

  return found;
}

/** Display API `/v2/video/list/`: una página de los vídeos públicos de la cuenta. */
async function listTikTokVideosPage(accessToken: string, cursor?: number) {
  const data = await tiktokApiRequest<TikTokVideoListResponse>(
    `/v2/video/list/?fields=${encodeURIComponent(VIDEO_FIELDS)}`,
    accessToken,
    {
      method: "POST",
      body: {
        max_count: TIKTOK_VIDEO_BATCH,
        ...(typeof cursor === "number" ? { cursor } : {}),
      },
    },
    "TIKTOK_VIDEO_LIST_ERROR"
  );

  return {
    videos: data.data?.videos || [],
    cursor: data.data?.cursor,
    has_more: Boolean(data.data?.has_more),
  };
}

/**
 * Busca un vídeo entre los de la cuenta vinculada. Devuelve null si TikTok
 * responde bien pero el vídeo no es de esa cuenta (o no existe / es privado).
 * Los fallos de red o de TikTok se propagan como `TikTokApiError`.
 */
export async function findOwnedTikTokVideo(
  account: TikTokAccountRow,
  videoId: string
): Promise<TikTokApiVideo | null> {
  return withAccountToken(account, async (accessToken) => {
    const byId = await queryTikTokVideosByIds(accessToken, [videoId]);
    const direct = byId.get(videoId);
    if (direct) return direct;

    // Respaldo: recorrer los vídeos más recientes de la cuenta.
    let cursor: number | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = await listTikTokVideosPage(accessToken, cursor);
      const match = result.videos.find((video) => String(video.id || "") === videoId);
      if (match) return match;
      if (!result.has_more || typeof result.cursor !== "number") break;
      cursor = result.cursor;
    }

    return null;
  });
}

const TIKTOK_SHORT_LINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

function isTikTokHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

function parseTikTokUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || !isTikTokHost(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractVideoId(url: URL) {
  const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/i);
  return match ? match[1] : null;
}

/**
 * Saca el id del vídeo de una URL de TikTok. Acepta
 * `https://www.tiktok.com/@usuario/video/ID` y los enlaces cortos de compartir
 * (`vm.tiktok.com/…`, `vt.tiktok.com/…`, `www.tiktok.com/t/…`). Los cortos se
 * resuelven siguiendo redirecciones a mano y solo dentro de tiktok.com: nunca
 * se descarga una URL de otro dominio.
 */
export async function resolveTikTokVideoId(rawUrl: string): Promise<string | null> {
  let current = parseTikTokUrl(rawUrl);
  if (!current) return null;

  const direct = extractVideoId(current);
  if (direct) return direct;

  const isShortLink =
    TIKTOK_SHORT_LINK_HOSTS.has(current.hostname.toLowerCase()) ||
    /^\/t\/[A-Za-z0-9]+\/?$/.test(current.pathname);
  if (!isShortLink) return null;

  for (let hop = 0; hop < 3; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return null;
    }

    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return null;

    let next: URL | null;
    try {
      next = parseTikTokUrl(new URL(location, current).toString());
    } catch {
      next = null;
    }
    if (!next) return null;

    const videoId = extractVideoId(next);
    if (videoId) return videoId;

    current = next;
  }

  return null;
}

/**
 * Guarda (o actualiza) un vídeo verificado del usuario. Un vídeo que ya asoció
 * otro usuario no se reasigna.
 */
export async function saveAssociatedTikTokVideo(params: {
  userId: number;
  openId: string;
  video: TikTokApiVideo & { id: string };
  fallbackShareUrl: string;
  leaderboardId: number | null;
}): Promise<TikTokVideoRow> {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();
  const video = params.video;

  const { data: existingRows, error: existingError } = await supabase
    .from("user_tiktok_videos")
    .select("id, user_id, leaderboard_id")
    .eq("video_id", video.id)
    .limit(1);

  if (existingError) throw existingError;

  const existing = existingRows?.[0];
  if (existing && existing.user_id !== params.userId) {
    throw new TikTokRuleError("VIDEO_ALREADY_ASSOCIATED");
  }

  const stats = {
    title: video.title || video.video_description || "Video sin titulo",
    cover_image_url: video.cover_image_url || null,
    share_url: video.share_url || params.fallbackShareUrl,
    like_count: Number(video.like_count || 0),
    view_count: Number(video.view_count || 0),
    comment_count: Number(video.comment_count || 0),
    share_count: Number(video.share_count || 0),
    last_refreshed_at: now,
    refresh_failures: 0,
    unavailable_at: null,
    tiktok_open_id: params.openId,
    updated_at: now,
  };

  if (existing) {
    const { data: updated, error } = await supabase
      .from("user_tiktok_videos")
      .update({
        ...stats,
        ...(video.create_time ? { created_at: video.create_time } : {}),
        ...(params.leaderboardId !== null
          ? { leaderboard_id: params.leaderboardId, associated_at: now }
          : {}),
      })
      .eq("id", existing.id)
      .eq("user_id", params.userId)
      .select("*");

    if (error) throw error;
    if (!updated?.[0]) throw new TikTokRuleError("VIDEO_ALREADY_ASSOCIATED");
    return updated[0] as TikTokVideoRow;
  }

  const { data: inserted, error } = await supabase
    .from("user_tiktok_videos")
    .insert({
      ...stats,
      user_id: params.userId,
      video_id: video.id,
      leaderboard_id: params.leaderboardId,
      associated_at: now,
      created_at: video.create_time || now,
    })
    .select("*");

  if (error) {
    // Otro usuario lo asoció entre la comprobación y el insert.
    if (error.code === "23505") {
      throw new TikTokRuleError("VIDEO_ALREADY_ASSOCIATED");
    }
    throw error;
  }

  return inserted[0] as TikTokVideoRow;
}

export async function getAssociatedTikTokVideos(
  userId: number,
  limit = 50
): Promise<TikTokVideoRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_tiktok_videos")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []) as TikTokVideoRow[];
}

export type TikTokRefreshSummary = {
  total: number;
  updated: number;
  // TikTok respondió bien pero ya no devuelve el vídeo.
  not_found: number;
  // Fallo temporal (red, TikTok, cuenta sin token válido): no penaliza al vídeo.
  failed: number;
  // No dio tiempo antes de `deadline`.
  skipped: number;
};

/**
 * Refresca los contadores de un conjunto de vídeos con la Display API, usando
 * el token del dueño de cada vídeo (una petición por cada 20 vídeos y usuario).
 *
 * Distingue "vídeo no encontrado" (TikTok responde y el vídeo no está: suma un
 * fallo, y al llegar a TIKTOK_VIDEO_MAX_REFRESH_FAILURES deja de contar) de
 * "fallo temporal" (no se toca el vídeo).
 */
export async function refreshTikTokVideoRows(
  rows: Array<Pick<TikTokVideoRow, "id" | "user_id" | "video_id" | "refresh_failures">>,
  options: { deadline?: number } = {}
): Promise<TikTokRefreshSummary> {
  const supabase = getSupabaseAdmin();
  const summary: TikTokRefreshSummary = {
    total: rows.length,
    updated: 0,
    not_found: 0,
    failed: 0,
    skipped: 0,
  };

  const byUser = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) || [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  await mapWithConcurrency(
    Array.from(byUser.entries()),
    REFRESH_USER_CONCURRENCY,
    async ([userId, userRows]) => {
      if (options.deadline && Date.now() > options.deadline) {
        summary.skipped += userRows.length;
        return;
      }

      let found: Map<string, TikTokApiVideo>;
      try {
        const account = await getUserTikTokConnection(userId);
        if (!account) {
          summary.failed += userRows.length;
          return;
        }

        found = await withAccountToken(account, (accessToken) =>
          queryTikTokVideosByIds(
            accessToken,
            userRows.map((row) => row.video_id)
          )
        );
      } catch (error) {
        if (!(error instanceof TikTokRelinkRequiredError)) {
          console.error(`Fallo temporal refrescando vídeos de TikTok (user ${userId}):`, error);
        }
        summary.failed += userRows.length;
        return;
      }

      const now = nowSeconds();

      await Promise.all(
        userRows.map(async (row) => {
          const video = found.get(row.video_id);

          if (!video) {
            const failures = (row.refresh_failures || 0) + 1;
            const { error } = await supabase
              .from("user_tiktok_videos")
              .update({
                refresh_failures: failures,
                ...(failures >= TIKTOK_VIDEO_MAX_REFRESH_FAILURES
                  ? { unavailable_at: now }
                  : {}),
                updated_at: now,
              })
              .eq("id", row.id);

            if (error) {
              console.error("Error marcando vídeo de TikTok no encontrado:", error);
              summary.failed += 1;
              return;
            }

            summary.not_found += 1;
            return;
          }

          const { error } = await supabase
            .from("user_tiktok_videos")
            .update({
              ...(video.title || video.video_description
                ? { title: video.title || video.video_description }
                : {}),
              ...(video.cover_image_url ? { cover_image_url: video.cover_image_url } : {}),
              ...(video.share_url ? { share_url: video.share_url } : {}),
              like_count: Number(video.like_count || 0),
              view_count: Number(video.view_count || 0),
              comment_count: Number(video.comment_count || 0),
              share_count: Number(video.share_count || 0),
              last_refreshed_at: now,
              refresh_failures: 0,
              unavailable_at: null,
              updated_at: now,
            })
            .eq("id", row.id);

          if (error) {
            console.error("Error guardando contadores de vídeo de TikTok:", error);
            summary.failed += 1;
            return;
          }

          summary.updated += 1;
        })
      );
    }
  );

  return summary;
}

export async function refreshTikTokVideoRowsByIds(videoRowIds: number[]) {
  const { data, error } = await getSupabaseAdmin()
    .from("user_tiktok_videos")
    .select("id, user_id, video_id, refresh_failures")
    .in("id", videoRowIds);

  if (error) throw error;

  return refreshTikTokVideoRows(data || []);
}

/**
 * Refresco manual pedido por el usuario. Tiene un enfriamiento por usuario
 * (`last_synced_at` de su cuenta) para que no se pueda martillear TikTok.
 */
export async function refreshAssociatedTikTokVideosStats(userId: number) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();

  const account = await getUserTikTokConnection(userId);
  if (!account) {
    throw new TikTokRuleError("TIKTOK_NOT_CONNECTED");
  }
  if (account.needs_relink) {
    throw new TikTokRelinkRequiredError();
  }

  // El enfriamiento se reclama con un update condicional: dos peticiones a la
  // vez no pasan las dos.
  const { data: claimed, error: claimError } = await supabase
    .from("user_tiktok_accounts")
    .update({ last_synced_at: now })
    .eq("user_id", userId)
    .or(
      `last_synced_at.is.null,last_synced_at.lte.${now - TIKTOK_MANUAL_REFRESH_COOLDOWN_SECONDS}`
    )
    .select("user_id");

  if (claimError) throw claimError;

  if (!claimed?.[0]) {
    const retryAfter = Math.max(
      1,
      (account.last_synced_at || now) + TIKTOK_MANUAL_REFRESH_COOLDOWN_SECONDS - now
    );
    return { cooldown: true as const, retry_after: retryAfter };
  }

  const { data: openBoards, error: boardsError } = await supabase
    .from("tiktok_leaderboards")
    .select("id")
    .in("status", OPEN_LEADERBOARD_STATUSES);

  if (boardsError) throw boardsError;

  const openIds = new Set((openBoards || []).map((board) => board.id));

  // Los vídeos de leaderboards ya finalizadas no se tocan: su resultado es el
  // snapshot.
  const videos = (await getAssociatedTikTokVideos(userId, 200)).filter(
    (video) => video.leaderboard_id === null || openIds.has(video.leaderboard_id)
  );

  const summary = await refreshTikTokVideoRows(videos);

  return { cooldown: false as const, ...summary };
}

export async function revokeTikTokAccess(token: string) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    token,
  });

  const response = await fetch(`${TIKTOK_OPEN_API_BASE}/v2/oauth/revoke/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "TIKTOK_REVOKE_ERROR");
  }
}

export async function unlinkTikTokAccount(userId: number) {
  const connection = await getUserTikTokConnection(userId);

  if (!connection) {
    return false;
  }

  // Primero los vídeos: si esto falla la cuenta sigue vinculada y se puede reintentar.
  await removeUserVideosFromOpenLeaderboards(userId);

  const { error } = await getSupabaseAdmin()
    .from("user_tiktok_accounts")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return true;
}

// El code_verifier de PKCE no viaja en el `state` (que es legible): se deriva
// en el servidor a partir de un nonce aleatorio del state.
function derivePkceVerifier(nonce: string) {
  return createHmac("sha256", derivedSecret("tiktok-pkce"))
    .update(nonce)
    .digest("base64url");
}

export function createTikTokLinkState(discordId: string) {
  const nonce = randomBytes(32).toString("base64url");

  const state = jwt.sign(
    { discord_id: discordId, nonce, purpose: "tiktok-link" },
    derivedSecret("tiktok-state"),
    { algorithm: "HS256", expiresIn: 60 * 10 }
  );

  const codeChallenge = createHash("sha256")
    .update(derivePkceVerifier(nonce))
    .digest("base64url");

  return {
    state,
    codeChallenge,
  };
}

export function verifyTikTokLinkState(state: string) {
  try {
    const decoded = jwt.verify(state, derivedSecret("tiktok-state"), {
      algorithms: ["HS256"],
    });

    if (
      typeof decoded !== "object" ||
      decoded.purpose !== "tiktok-link" ||
      typeof decoded.discord_id !== "string" ||
      typeof decoded.nonce !== "string"
    ) {
      return null;
    }

    return {
      discord_id: decoded.discord_id as string,
      code_verifier: derivePkceVerifier(decoded.nonce),
    };
  } catch {
    return null;
  }
}
