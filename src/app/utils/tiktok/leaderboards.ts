import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { refreshTikTokVideoRows, type TikTokVideoRow } from "./index";

// scheduled → active → finalizing → in_review → closed, y cancelled.
// `finalizing`: la leaderboard ha terminado y se están refrescando los
// contadores antes de guardar el snapshot final.
export type TikTokLeaderboardStatus =
  | "scheduled"
  | "active"
  | "finalizing"
  | "in_review"
  | "closed"
  | "cancelled";

// `substitute`: fila del snapshot final sin premio (suplente).
export type TikTokResultStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "prize_delivered"
  | "disqualified"
  | "substitute";

export type TikTokPrizeInput = {
  position: number;
  reward: string;
};

export type TikTokLeaderboardInput = {
  title: string;
  description?: string | null;
  start_at: number;
  end_at: number;
  prizes: TikTokPrizeInput[];
};

type LeaderboardRow = {
  id: number;
  title: string;
  description: string | null;
  start_at: number;
  end_at: number;
  status: TikTokLeaderboardStatus;
  finalized_at: number | null;
  review_notes: string | null;
  has_reallocation: boolean;
  reallocation_count: number;
  created_at: number;
  updated_at: number;
};

type PrizeRow = { id: number; leaderboard_id: number; position: number; reward: string };

// Transiciones que puede pedir el admin. Activar y pasar a revisión las hace el
// cron (la revisión necesita el snapshot final).
const ADMIN_STATUS_TRANSITIONS: Record<TikTokLeaderboardStatus, TikTokLeaderboardStatus[]> = {
  scheduled: ["cancelled"],
  active: ["cancelled"],
  finalizing: ["cancelled"],
  in_review: ["closed"],
  closed: [],
  cancelled: [],
};

const EDITABLE_STATUSES: TikTokLeaderboardStatus[] = ["scheduled", "active"];

// Suplentes que guarda el snapshot final por debajo del último puesto premiado.
const FINAL_SNAPSHOT_SUBSTITUTES = 100;
// Tiempo máximo esperando a refrescar contadores tras el fin antes de cerrar el
// snapshot con lo que haya.
const FINALIZE_MAX_WAIT_SECONDS = 30 * 60;
// Margen de trabajo de un tick del cron.
const TICK_REFRESH_BUDGET_MS = 40_000;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function single<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizePrizes(prizes: TikTokPrizeInput[]) {
  const normalized = prizes
    .map((prize) => ({
      position: Number(prize.position),
      reward: String(prize.reward || "").trim(),
    }))
    .filter((prize) => Number.isInteger(prize.position) && prize.position > 0 && prize.reward.length > 0)
    .sort((a, b) => a.position - b.position);

  if (normalized.length === 0) {
    throw new Error("LEADERBOARD_PRIZES_REQUIRED");
  }

  const seen = new Set<number>();
  for (const prize of normalized) {
    if (seen.has(prize.position)) {
      throw new Error("LEADERBOARD_PRIZES_DUPLICATED_POSITION");
    }
    seen.add(prize.position);
  }

  return normalized;
}

function validateLeaderboardInput(input: TikTokLeaderboardInput, now: number) {
  const title = input.title.trim();

  if (!title) throw new Error("LEADERBOARD_TITLE_REQUIRED");
  if (!Number.isInteger(input.start_at) || !Number.isInteger(input.end_at)) {
    throw new Error("LEADERBOARD_INVALID_DATES");
  }
  if (input.start_at >= input.end_at) throw new Error("LEADERBOARD_INVALID_RANGE");
  // Una leaderboard ya terminada necesitaría un snapshot que nadie ha hecho.
  if (input.end_at <= now) throw new Error("LEADERBOARD_END_IN_PAST");

  return { title, prizes: normalizePrizes(input.prizes) };
}

async function assertLeaderboardWindowNoOverlap(startAt: number, endAt: number, exceptId?: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .select("id, start_at, end_at, status");

  if (error) throw error;

  const conflicting = (data || []).find((row) => {
    if (row.status === "cancelled") return false;
    if (exceptId && row.id === exceptId) return false;
    return !(row.end_at <= startAt || row.start_at >= endAt);
  });

  if (conflicting) {
    throw new Error("LEADERBOARD_OVERLAP_NOT_ALLOWED");
  }
}

async function getLeaderboardRow(leaderboardId: number): Promise<LeaderboardRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .select("*")
    .eq("id", leaderboardId)
    .limit(1);

  if (error) throw error;

  return (data?.[0] as LeaderboardRow | undefined) ?? null;
}

async function getLeaderboardPrizes(leaderboardId: number): Promise<PrizeRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboard_prizes")
    .select("id, leaderboard_id, position, reward")
    .eq("leaderboard_id", leaderboardId)
    .order("position", { ascending: true });

  if (error) throw error;

  return (data || []) as PrizeRow[];
}

export async function createTikTokLeaderboard(input: TikTokLeaderboardInput) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();
  const { title, prizes } = validateLeaderboardInput(input, now);

  await assertLeaderboardWindowNoOverlap(input.start_at, input.end_at);

  const status: TikTokLeaderboardStatus = input.start_at <= now ? "active" : "scheduled";

  const { data: inserted, error } = await supabase
    .from("tiktok_leaderboards")
    .insert({
      title,
      description: input.description?.trim() || null,
      start_at: input.start_at,
      end_at: input.end_at,
      status,
      created_at: now,
      updated_at: now,
    })
    .select("*");

  if (error) throw error;

  const leaderboard = inserted?.[0];
  if (!leaderboard) throw new Error("LEADERBOARD_CREATE_FAILED");

  const { error: prizesError } = await supabase.from("tiktok_leaderboard_prizes").insert(
    prizes.map((prize) => ({
      leaderboard_id: leaderboard.id,
      position: prize.position,
      reward: prize.reward,
      created_at: now,
    }))
  );

  if (prizesError) {
    // Sin premios la leaderboard no sirve: se deshace para no dejarla a medias.
    const { error: rollbackError } = await supabase
      .from("tiktok_leaderboards")
      .delete()
      .eq("id", leaderboard.id);
    if (rollbackError) {
      console.error("No se pudo deshacer la leaderboard sin premios:", rollbackError);
    }
    throw prizesError;
  }

  return leaderboard;
}

export async function updateTikTokLeaderboard(leaderboardId: number, input: TikTokLeaderboardInput) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();
  const { title, prizes } = validateLeaderboardInput(input, now);

  const current = await getLeaderboardRow(leaderboardId);
  if (!current) throw new Error("LEADERBOARD_NOT_FOUND");
  if (!EDITABLE_STATUSES.includes(current.status)) {
    throw new Error("LEADERBOARD_LOCKED_FOR_EDIT");
  }

  await assertLeaderboardWindowNoOverlap(input.start_at, input.end_at, leaderboardId);

  const oldPrizes = await getLeaderboardPrizes(leaderboardId);

  // Los premios nuevos se insertan antes de tocar nada más; si un paso
  // posterior falla se retiran y la leaderboard queda como estaba.
  const { data: newPrizes, error: insertPrizesError } = await supabase
    .from("tiktok_leaderboard_prizes")
    .insert(
      prizes.map((prize) => ({
        leaderboard_id: leaderboardId,
        position: prize.position,
        reward: prize.reward,
        created_at: now,
      }))
    )
    .select("id");

  if (insertPrizesError) throw insertPrizesError;

  const newPrizeIds = (newPrizes || []).map((prize) => prize.id);
  const undoNewPrizes = async () => {
    const { error } = await supabase
      .from("tiktok_leaderboard_prizes")
      .delete()
      .in("id", newPrizeIds);
    if (error) console.error("No se pudieron retirar los premios nuevos:", error);
  };

  const { data: updated, error: updateError } = await supabase
    .from("tiktok_leaderboards")
    .update({
      title,
      description: input.description?.trim() || null,
      start_at: input.start_at,
      end_at: input.end_at,
      status: input.start_at <= now ? "active" : "scheduled",
      updated_at: now,
    })
    .eq("id", leaderboardId)
    .in("status", EDITABLE_STATUSES)
    .select("id");

  if (updateError || !updated?.[0]) {
    await undoNewPrizes();
    if (updateError) throw updateError;
    // El cron la pasó a finalizing mientras se editaba.
    throw new Error("LEADERBOARD_LOCKED_FOR_EDIT");
  }

  if (oldPrizes.length > 0) {
    const { error: deletePrizesError } = await supabase
      .from("tiktok_leaderboard_prizes")
      .delete()
      .in(
        "id",
        oldPrizes.map((prize) => prize.id)
      );

    if (deletePrizesError) {
      await undoNewPrizes();
      throw deletePrizesError;
    }
  }
}

export async function setTikTokLeaderboardStatus(
  leaderboardId: number,
  status: TikTokLeaderboardStatus,
  reviewNotes?: string
) {
  const now = nowSeconds();

  const current = await getLeaderboardRow(leaderboardId);
  if (!current) throw new Error("LEADERBOARD_NOT_FOUND");

  if (!(ADMIN_STATUS_TRANSITIONS[current.status] || []).includes(status)) {
    throw new Error("LEADERBOARD_INVALID_TRANSITION");
  }

  const notes = reviewNotes?.trim();

  const { data: updated, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .update({
      status,
      updated_at: now,
      ...(notes ? { review_notes: notes } : {}),
    })
    .eq("id", leaderboardId)
    .eq("status", current.status)
    .select("id");

  if (error) throw error;
  // El estado cambió entre la lectura y el update (p. ej. el cron).
  if (!updated?.[0]) throw new Error("LEADERBOARD_INVALID_TRANSITION");
}

export async function deleteTikTokLeaderboard(leaderboardId: number) {
  const supabase = getSupabaseAdmin();

  // Los vídeos sobreviven a la leaderboard (quedan sueltos).
  const { error: detachError } = await supabase
    .from("user_tiktok_videos")
    .update({ leaderboard_id: null })
    .eq("leaderboard_id", leaderboardId);
  if (detachError) throw detachError;

  const { data, error } = await supabase
    .from("tiktok_leaderboards")
    .delete()
    .eq("id", leaderboardId)
    .select("id");
  if (error) throw error;
  if (!data?.[0]) throw new Error("LEADERBOARD_NOT_FOUND");
}

type ResultRow = {
  id: number;
  leaderboard_id: number;
  position: number | null;
  original_position: number | null;
  user_id: number;
  video_row_id: number | null;
  video_id: string;
  video_title: string;
  video_cover_image_url: string | null;
  video_share_url: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  reward: string | null;
  status: TikTokResultStatus;
  review_note: string | null;
  winner_notified_at: number | null;
  created_at: number;
  updated_at: number;
};

type ResultWithUser = ResultRow & { username: string | null; user_image: string | null };

/** Filas del snapshot final: primero las que tienen puesto, al final las descalificadas. */
async function getLeaderboardResults(leaderboardId: number): Promise<ResultWithUser[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboard_results")
    .select("*, user:users!tiktok_leaderboard_results_user_id_fkey(username, image)")
    .eq("leaderboard_id", leaderboardId)
    .order("position", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => {
    const { user: rawUser, ...rest } = row;
    const user = single<{ username: string | null; image: string | null }>(rawUser);
    return {
      ...(rest as ResultRow),
      username: user?.username || null,
      user_image: user?.image || null,
    };
  });
}

export async function getTikTokLeaderboardResultById(resultId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboard_results")
    .select(
      "*, leaderboard:tiktok_leaderboards!tiktok_leaderboard_results_leaderboard_id_fkey(id, title, status), user:users!tiktok_leaderboard_results_user_id_fkey(discord_id, email, username, image)"
    )
    .eq("id", resultId)
    .limit(1);

  if (error) throw error;

  const row = data?.[0];
  if (!row) return null;

  const { leaderboard, user, ...rest } = row;

  return {
    ...(rest as ResultRow),
    leaderboard: single<{ id: number; title: string; status: TikTokLeaderboardStatus }>(leaderboard),
    user: single<{
      discord_id: string | null;
      email: string | null;
      username: string | null;
      image: string | null;
    }>(user),
  };
}

export async function getTikTokLeaderboardForVideoAssociation(leaderboardId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .select("id, title, start_at, end_at, status")
    .eq("id", leaderboardId)
    .limit(1);

  if (error) throw error;

  return (
    (data?.[0] as
      | Pick<LeaderboardRow, "id" | "title" | "start_at" | "end_at" | "status">
      | undefined) ?? null
  );
}

type BoardVideo = TikTokVideoRow & {
  username: string | null;
  user_image: string | null;
  user_banned: boolean;
  // Motivo por el que el vídeo no cuenta, o null si cuenta.
  excluded_reason: "video_banned" | "user_banned" | "unavailable" | "outside_window" | null;
};

/**
 * Todos los vídeos asociados a una leaderboard, ordenados como el ranking
 * (visualizaciones, y a igualdad quien lo asoció antes). Solo cuentan los que
 * tienen `leaderboard_id` de esta leaderboard: se asigna únicamente a vídeos
 * publicados dentro de su ventana.
 */
async function getLeaderboardVideos(
  board: Pick<LeaderboardRow, "id" | "start_at" | "end_at">
): Promise<BoardVideo[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_tiktok_videos")
    .select("*, user:users!user_tiktok_videos_user_id_users_id_fk(username, image, is_banned)")
    .eq("leaderboard_id", board.id)
    .order("view_count", { ascending: false })
    .order("associated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(2000);

  if (error) throw error;

  return (data || []).map((row) => {
    const { user: rawUser, ...rest } = row;
    const user = single<{ username: string | null; image: string | null; is_banned: boolean | null }>(
      rawUser
    );
    const video = rest as TikTokVideoRow;
    const userBanned = Boolean(user?.is_banned);

    const excluded: BoardVideo["excluded_reason"] = video.is_banned
      ? "video_banned"
      : userBanned
        ? "user_banned"
        : video.unavailable_at
          ? "unavailable"
          : video.created_at < board.start_at || video.created_at > board.end_at
            ? "outside_window"
            : null;

    return {
      ...video,
      username: user?.username || null,
      user_image: user?.image || null,
      user_banned: userBanned,
      excluded_reason: excluded,
    };
  });
}

/** Ranking elegible: un puesto por usuario (su mejor vídeo). */
function buildRanking(videos: BoardVideo[]) {
  const seenUsers = new Set<number>();
  const ranking: Array<BoardVideo & { position: number }> = [];

  for (const video of videos) {
    if (video.excluded_reason || seenUsers.has(video.user_id)) continue;
    seenUsers.add(video.user_id);
    ranking.push({ ...video, position: ranking.length + 1 });
  }

  return ranking;
}

function prizeMapOf(prizes: Array<{ position: number; reward: string }>) {
  return new Map(prizes.map((prize) => [prize.position, prize.reward]));
}

function toLiveRankingEntry(
  video: BoardVideo & { position: number },
  prizeByPosition: Map<number, string>
) {
  return {
    id: video.id,
    user_id: video.user_id,
    position: video.position,
    username: video.username,
    user_image: video.user_image,
    video_row_id: video.id,
    video_id: video.video_id,
    video_title: video.title,
    video_cover_image_url: video.cover_image_url,
    video_share_url: video.share_url,
    view_count: video.view_count,
    like_count: video.like_count,
    comment_count: video.comment_count,
    share_count: video.share_count,
    reward: prizeByPosition.get(video.position) ?? null,
    // En competición: todavía no hay resultado que revisar.
    status: "active",
    associated_at: video.associated_at,
  };
}

/** Vídeos que hay que refrescar periódicamente: los que cuentan en leaderboards en curso. */
export async function getActiveLeaderboardVideoCandidates() {
  const now = nowSeconds();

  const { data: activeBoards, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .select("id, start_at, end_at, status")
    .in("status", ["scheduled", "active"])
    .lte("start_at", now)
    .gt("end_at", now);

  if (error) throw error;

  const perBoard = await Promise.all(
    (activeBoards || []).map(async (board) => {
      const videos = await getLeaderboardVideos(board);
      return videos
        // Los dados por no disponibles se siguen comprobando: si TikTok vuelve a
        // devolverlos, vuelven a contar.
        .filter((video) => !video.excluded_reason || video.excluded_reason === "unavailable")
        .map((video) => ({
          leaderboard_id: board.id,
          video_row_id: video.id,
          video_id: video.video_id,
          user_id: video.user_id,
        }));
    })
  );

  return perBoard.flat();
}

/**
 * Vista del admin del ranking en vivo: todos los vídeos asociados, con el
 * puesto de los que cuentan y el motivo de exclusión de los que no.
 */
export async function getAdminLeaderboardLiveRanking(leaderboardId: number) {
  const board = await getLeaderboardRow(leaderboardId);
  if (!board) return null;

  const [videos, prizes] = await Promise.all([
    getLeaderboardVideos(board),
    getLeaderboardPrizes(board.id),
  ]);

  const prizeByPosition = prizeMapOf(prizes);
  const positionByRow = new Map(buildRanking(videos).map((entry) => [entry.id, entry.position]));

  return {
    leaderboard_id: board.id,
    status: board.status,
    videos: videos.map((video) => {
      const position = positionByRow.get(video.id) ?? null;
      return {
        video_row_id: video.id,
        user_id: video.user_id,
        username: video.username,
        user_image: video.user_image,
        video_id: video.video_id,
        video_title: video.title,
        video_share_url: video.share_url,
        view_count: video.view_count,
        like_count: video.like_count,
        created_at: video.created_at,
        associated_at: video.associated_at,
        last_refreshed_at: video.last_refreshed_at,
        refresh_failures: video.refresh_failures,
        is_banned: video.is_banned,
        user_banned: video.user_banned,
        // Cuenta pero no puntúa: el usuario ya tiene un vídeo mejor en el ranking.
        excluded_reason:
          video.excluded_reason || (position === null ? "not_best_video" : null),
        position,
        reward: position !== null ? prizeByPosition.get(position) ?? null : null,
      };
    }),
  };
}

export async function setTikTokVideoBanned(videoRowId: number, isBanned: boolean) {
  const { data, error } = await getSupabaseAdmin()
    .from("user_tiktok_videos")
    .update({ is_banned: isBanned, updated_at: nowSeconds() })
    .eq("id", videoRowId)
    .select("id, is_banned, leaderboard_id");

  if (error) throw error;

  return data?.[0] ?? null;
}

export async function getAdminTikTokLeaderboards() {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .order("start_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const boards = (rows || []) as LeaderboardRow[];
  const ids = boards.map((row) => row.id);
  if (ids.length === 0) return [];

  // Los resultados se piden por leaderboard: una sola consulta para todas se
  // quedaría corta con el límite de filas de PostgREST.
  const [{ data: prizes, error: prizesError }, results] = await Promise.all([
    supabase
      .from("tiktok_leaderboard_prizes")
      .select("*")
      .in("leaderboard_id", ids)
      .order("position", { ascending: true }),
    Promise.all(
      boards.map((row) =>
        row.status === "in_review" || row.status === "closed"
          ? getLeaderboardResults(row.id)
          : Promise.resolve([])
      )
    ).then((perBoard) => perBoard.flat()),
  ]);

  if (prizesError) throw prizesError;

  return boards.map((row) => ({
    ...row,
    prizes: ((prizes || []) as PrizeRow[])
      .filter((prize) => prize.leaderboard_id === row.id)
      .map((prize) => ({ id: prize.id, position: prize.position, reward: prize.reward })),
    results: results.filter((result) => result.leaderboard_id === row.id),
  }));
}

// Lo que ve el público de una fila del snapshot. Sin `review_note`: son notas
// internas del admin. Un descalificado se muestra con el puesto que perdió.
function toPublicResult(result: ResultWithUser) {
  return {
    id: result.id,
    leaderboard_id: result.leaderboard_id,
    user_id: result.user_id,
    position: result.position ?? result.original_position ?? 0,
    username: result.username,
    user_image: result.user_image,
    video_id: result.video_id,
    video_title: result.video_title,
    video_cover_image_url: result.video_cover_image_url,
    video_share_url: result.video_share_url,
    view_count: result.view_count,
    like_count: result.like_count,
    comment_count: result.comment_count,
    share_count: result.share_count,
    reward: result.reward,
    // Los suplentes no tienen estado de revisión que enseñar.
    ...(result.status === "substitute" ? {} : { status: result.status }),
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

function isInActiveWindow(row: Pick<LeaderboardRow, "status" | "start_at" | "end_at">, now: number) {
  return (
    row.status === "active" ||
    (row.status === "scheduled" && row.start_at <= now && row.end_at > now)
  );
}

// Campos públicos de la leaderboard. Sin `review_notes` (internas). El estado
// intermedio `finalizing` se publica como `in_review`.
function toPublicBoard(row: LeaderboardRow, now: number) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status === "finalizing" ? "in_review" : row.status,
    finalized_at: row.finalized_at,
    has_reallocation: row.has_reallocation,
    reallocation_count: row.reallocation_count,
    is_active: isInActiveWindow(row, now),
  };
}

/**
 * Ranking público de una leaderboard: el snapshot final si ya existe (en
 * revisión o cerrada), el ranking en vivo si no.
 */
async function getPublicRanking(row: LeaderboardRow, prizes: PrizeRow[], limit: number) {
  if (row.status === "in_review" || row.status === "closed") {
    const results = await getLeaderboardResults(row.id);
    return {
      ranking: results
        .filter((result) => result.position !== null)
        .slice(0, limit)
        .map(toPublicResult),
      snapshots: results.map(toPublicResult),
      last_refreshed_at: row.finalized_at,
    };
  }

  const videos = await getLeaderboardVideos(row);
  const prizeByPosition = prizeMapOf(prizes);
  const counted = buildRanking(videos);

  return {
    ranking: counted.slice(0, limit).map((video) => toLiveRankingEntry(video, prizeByPosition)),
    snapshots: [],
    last_refreshed_at: counted.reduce<number | null>(
      (latest, video) =>
        video.last_refreshed_at && (latest === null || video.last_refreshed_at > latest)
          ? video.last_refreshed_at
          : latest,
      null
    ),
  };
}

// El cron de refresco corre a las horas en punto (vercel.json: "0 * * * *").
function nextHourlyRefreshAt(now: number) {
  return Math.floor(now / 3600) * 3600 + 3600;
}

export async function getPublicTikTokLeaderboards() {
  const now = nowSeconds();

  const { data: rows, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboards")
    .select("*")
    .neq("status", "cancelled")
    .order("start_at", { ascending: false });

  if (error) throw error;

  const withPayload = await Promise.all(
    ((rows || []) as LeaderboardRow[]).map(async (row) => {
      const prizes = await getLeaderboardPrizes(row.id);
      const { ranking } = await getPublicRanking(row, prizes, 25);

      return {
        ...toPublicBoard(row, now),
        prizes: prizes.map((prize) => ({ position: prize.position, reward: prize.reward })),
        ranking,
      };
    })
  );

  return {
    active: withPayload.filter((row) => row.is_active),
    past: withPayload.filter((row) => !row.is_active),
  };
}

export async function getPublicTikTokLeaderboardById(leaderboardId: number) {
  const now = nowSeconds();

  const row = await getLeaderboardRow(leaderboardId);
  if (!row || row.status === "cancelled") return null;

  const prizes = await getLeaderboardPrizes(row.id);
  const { ranking, snapshots, last_refreshed_at } = await getPublicRanking(row, prizes, 500);
  const board = toPublicBoard(row, now);

  return {
    ...board,
    prizes: prizes.map((prize) => ({ position: prize.position, reward: prize.reward })),
    ranking,
    snapshots,
    last_refreshed_at,
    next_refresh_at: board.is_active ? nextHourlyRefreshAt(now) : null,
  };
}

/**
 * Cambia el estado de revisión de un resultado premiado. La nota solo se
 * sobrescribe si se envía una.
 */
export async function updateTikTokLeaderboardResultReview(params: {
  resultId: number;
  status: "pending_review" | "approved" | "rejected" | "prize_delivered";
  reviewNote?: string;
}) {
  const current = await getTikTokLeaderboardResultById(params.resultId);
  if (!current) throw new Error("RESULT_NOT_FOUND");

  if (current.status === "disqualified") throw new Error("RESULT_DISQUALIFIED");
  if (current.status === "substitute" || current.position === null || !current.reward) {
    throw new Error("RESULT_WITHOUT_PRIZE");
  }

  const boardStatus = current.leaderboard?.status;
  if (boardStatus === "closed") {
    // Cerrada la revisión solo queda apuntar la entrega del premio.
    if (params.status !== "prize_delivered") throw new Error("LEADERBOARD_CLOSED");
  } else if (boardStatus !== "in_review") {
    throw new Error("LEADERBOARD_NOT_IN_REVIEW");
  }

  const note = params.reviewNote?.trim();

  const { data: updated, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboard_results")
    .update({
      status: params.status,
      updated_at: nowSeconds(),
      ...(note ? { review_note: note } : {}),
    })
    .eq("id", params.resultId)
    .eq("status", current.status)
    .select("*");

  if (error) throw error;
  if (!updated?.[0]) throw new Error("RESULT_CHANGED_RETRY");

  return { previous: current, updated: updated[0] as ResultRow };
}

/**
 * Reclama el aviso de ganador de un resultado. Devuelve true solo la primera
 * vez (aprobar → rechazar → aprobar no reenvía el email). Si el resultado
 * cambia de puesto por una reasignación, el aviso se vuelve a habilitar.
 */
export async function claimTikTokWinnerNotification(resultId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("tiktok_leaderboard_results")
    .update({ winner_notified_at: nowSeconds() })
    .eq("id", resultId)
    .is("winner_notified_at", null)
    .select("id");

  if (error) throw error;

  return Boolean(data?.[0]);
}

/**
 * Recoloca los resultados con puesto en 1..n sin huecos y les asigna el premio
 * del puesto que ocupan. Es idempotente: se puede repetir si falla a medias.
 *
 * Se recorre de arriba abajo y cada fila solo puede subir, así que el puesto de
 * destino siempre está libre y no choca con el índice único de posiciones.
 */
async function reflowLeaderboardResults(leaderboardId: number) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();

  const prizeByPosition = prizeMapOf(await getLeaderboardPrizes(leaderboardId));

  const { data, error } = await supabase
    .from("tiktok_leaderboard_results")
    .select("id, position, reward, status")
    .eq("leaderboard_id", leaderboardId)
    .not("position", "is", null)
    .order("position", { ascending: true });

  if (error) throw error;

  const rows = (data || []) as Array<Pick<ResultRow, "id" | "position" | "reward" | "status">>;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const position = index + 1;
    const reward = prizeByPosition.get(position) ?? null;
    const changed = row.position !== position || row.reward !== reward;

    let status = row.status;
    let resetNotification = false;

    if (reward === null) {
      if (status !== "substitute") {
        status = "substitute";
        resetNotification = true;
      }
    } else if (status === "substitute") {
      // Un suplente entra en puesto premiado: pasa a revisión.
      status = "pending_review";
    } else if (changed && status === "approved") {
      // Ya se le avisó de otro puesto/premio: vuelve a revisión y se le avisará
      // de nuevo al aprobar.
      status = "pending_review";
      resetNotification = true;
    }

    if (!changed && status === row.status) continue;

    const { error: updateError } = await supabase
      .from("tiktok_leaderboard_results")
      .update({
        position,
        reward,
        status,
        updated_at: now,
        ...(resetNotification ? { winner_notified_at: null } : {}),
      })
      .eq("id", row.id);

    if (updateError) throw updateError;
  }
}

/**
 * Descalifica un resultado: pierde su puesto y los siguientes elegibles suben
 * uno, heredando el premio del puesto que pasan a ocupar. El primer suplente
 * entra en el último puesto premiado.
 *
 * Repetir la llamada sobre un resultado ya descalificado solo termina la
 * recolocación (por si falló a medias) sin volver a contar el reajuste.
 */
export async function disqualifyAndReallocateTikTokLeaderboardResult(params: {
  resultId: number;
  reviewNote?: string;
}) {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();

  const current = await getTikTokLeaderboardResultById(params.resultId);
  if (!current) throw new Error("RESULT_NOT_FOUND");
  if (current.leaderboard?.status !== "in_review") {
    throw new Error("LEADERBOARD_NOT_IN_REVIEW");
  }

  let newlyDisqualified = false;

  if (current.status !== "disqualified") {
    const { data: disqualified, error: disqualifyError } = await supabase
      .from("tiktok_leaderboard_results")
      .update({
        status: "disqualified",
        position: null,
        original_position: current.original_position ?? current.position,
        review_note: params.reviewNote?.trim() || "Usuario descalificado manualmente.",
        updated_at: now,
      })
      .eq("id", params.resultId)
      .neq("status", "disqualified")
      .select("id");

    if (disqualifyError) throw disqualifyError;
    newlyDisqualified = Boolean(disqualified?.[0]);
  }

  await reflowLeaderboardResults(current.leaderboard_id);

  // Solo es un reajuste de premios si el descalificado ocupaba puesto premiado.
  if (newlyDisqualified && current.reward && current.status !== "substitute") {
    const board = await getLeaderboardRow(current.leaderboard_id);
    if (board) {
      const { error: boardError } = await supabase
        .from("tiktok_leaderboards")
        .update({
          has_reallocation: true,
          reallocation_count: (board.reallocation_count || 0) + 1,
          updated_at: now,
        })
        .eq("id", board.id);

      if (boardError) throw boardError;
    }
  }
}

/**
 * Finaliza una leaderboard en estado `finalizing`:
 *  1. refresca los contadores de los vídeos que no se han leído desde el fin;
 *  2. guarda el snapshot final (ranking elegible completo: ganadores y suplentes);
 *  3. la pasa a `in_review`.
 *
 * Idempotente: si el snapshot ya existe no se reescribe, y el índice único
 * (leaderboard_id, position) impide que dos ejecuciones a la vez lo dupliquen.
 * Devuelve false si todavía quedan contadores por refrescar (se reintenta en el
 * siguiente tick).
 */
async function finalizeLeaderboard(board: LeaderboardRow, deadline: number) {
  const supabase = getSupabaseAdmin();

  let videos = await getLeaderboardVideos(board);
  const staleOf = (list: BoardVideo[]) =>
    list.filter(
      (video) => !video.excluded_reason && (video.last_refreshed_at || 0) < board.end_at
    );

  const waitExpired = nowSeconds() >= board.end_at + FINALIZE_MAX_WAIT_SECONDS;

  if (!waitExpired && staleOf(videos).length > 0) {
    await refreshTikTokVideoRows(staleOf(videos), { deadline });
    videos = await getLeaderboardVideos(board);

    if (staleOf(videos).length > 0) {
      return false;
    }
  }

  const { count, error: countError } = await supabase
    .from("tiktok_leaderboard_results")
    .select("id", { count: "exact", head: true })
    .eq("leaderboard_id", board.id);

  if (countError) throw countError;

  const now = nowSeconds();

  if (!count) {
    const prizes = await getLeaderboardPrizes(board.id);
    const prizeByPosition = prizeMapOf(prizes);
    const lastPrizePosition = prizes.reduce((max, prize) => Math.max(max, prize.position), 0);
    const rows = buildRanking(videos)
      .slice(0, lastPrizePosition + FINAL_SNAPSHOT_SUBSTITUTES)
      .map((entry) => {
        const reward = prizeByPosition.get(entry.position) ?? null;
        return {
          leaderboard_id: board.id,
          position: entry.position,
          user_id: entry.user_id,
          video_row_id: entry.id,
          video_id: entry.video_id,
          video_title: entry.title,
          video_cover_image_url: entry.cover_image_url,
          video_share_url: entry.share_url,
          view_count: entry.view_count,
          like_count: entry.like_count,
          comment_count: entry.comment_count,
          share_count: entry.share_count,
          reward,
          status: reward === null ? "substitute" : "pending_review",
          review_note: null,
          created_at: now,
          updated_at: now,
        };
      });

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("tiktok_leaderboard_results")
        .insert(rows);

      // 23505: otra ejecución guardó el snapshot a la vez; vale el suyo.
      if (insertError && insertError.code !== "23505") throw insertError;
    }
  }

  const { error: statusError } = await supabase
    .from("tiktok_leaderboards")
    .update({ status: "in_review", finalized_at: now, updated_at: now })
    .eq("id", board.id)
    .eq("status", "finalizing");

  if (statusError) throw statusError;

  return true;
}

export async function processTikTokLeaderboardsTick() {
  const supabase = getSupabaseAdmin();
  const now = nowSeconds();
  const deadline = Date.now() + TICK_REFRESH_BUDGET_MS;
  const errors: Array<{ step: string; leaderboard_id?: number; error: string }> = [];
  const describe = (error: unknown) =>
    error instanceof Error
      ? error.message
      : String((error as { message?: string } | null)?.message || error);

  const { data: activations, error: activationError } = await supabase
    .from("tiktok_leaderboards")
    .update({ status: "active", updated_at: now })
    .eq("status", "scheduled")
    .lte("start_at", now)
    .gt("end_at", now)
    .select("id");

  if (activationError) {
    console.error("[TikTok] Error activando leaderboards:", activationError);
    errors.push({ step: "activate", error: describe(activationError) });
  }

  // Reclamo: la leaderboard terminada sale de scheduled/active con un update
  // condicional. A partir de aquí no admite vídeos ni ediciones.
  const { error: claimError } = await supabase
    .from("tiktok_leaderboards")
    .update({ status: "finalizing", updated_at: now })
    .in("status", ["scheduled", "active"])
    .lte("end_at", now);

  if (claimError) {
    console.error("[TikTok] Error reclamando leaderboards terminadas:", claimError);
    errors.push({ step: "claim", error: describe(claimError) });
  }

  const { data: toFinalize, error: toFinalizeError } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .eq("status", "finalizing")
    .order("end_at", { ascending: true });

  if (toFinalizeError) throw toFinalizeError;

  let finalized = 0;
  let pending = 0;

  for (const board of (toFinalize || []) as LeaderboardRow[]) {
    try {
      if (await finalizeLeaderboard(board, deadline)) {
        finalized += 1;
      } else {
        pending += 1;
      }
    } catch (error) {
      // Un fallo en una leaderboard no bloquea las demás; se reintenta en el
      // siguiente tick porque sigue en `finalizing`.
      console.error(`[TikTok] Error finalizando leaderboard ${board.id}:`, error);
      errors.push({ step: "finalize", leaderboard_id: board.id, error: describe(error) });
      pending += 1;
    }
  }

  return {
    activated: (activations || []).length,
    finalized,
    pending,
    errors,
  };
}
