"use server";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export type TikTokLeaderboardStatus =
  | "scheduled"
  | "active"
  | "in_review"
  | "closed"
  | "cancelled";

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

async function assertLeaderboardWindowNoOverlap(startAt: number, endAt: number, exceptId?: number) {
  const { data, error } = await supabase
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

export async function createTikTokLeaderboard(input: TikTokLeaderboardInput) {
  const now = Math.floor(Date.now() / 1000);
  const title = input.title.trim();

  if (!title) throw new Error("LEADERBOARD_TITLE_REQUIRED");
  if (!Number.isInteger(input.start_at) || !Number.isInteger(input.end_at)) {
    throw new Error("LEADERBOARD_INVALID_DATES");
  }
  if (input.start_at >= input.end_at) throw new Error("LEADERBOARD_INVALID_RANGE");

  const prizes = normalizePrizes(input.prizes);
  await assertLeaderboardWindowNoOverlap(input.start_at, input.end_at);

  const status: TikTokLeaderboardStatus =
    input.end_at <= now ? "in_review" : input.start_at <= now ? "active" : "scheduled";

  const { data: inserted, error } = await supabase
    .from("tiktok_leaderboards")
    .insert({
      title,
      description: input.description?.trim() || null,
      start_at: input.start_at,
      end_at: input.end_at,
      status,
      finalized_at: status === "in_review" ? now : null,
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

  if (prizesError) throw prizesError;

  return leaderboard;
}

export async function updateTikTokLeaderboard(leaderboardId: number, input: TikTokLeaderboardInput) {
  const now = Math.floor(Date.now() / 1000);
  const title = input.title.trim();

  if (!title) throw new Error("LEADERBOARD_TITLE_REQUIRED");
  if (!Number.isInteger(input.start_at) || !Number.isInteger(input.end_at)) {
    throw new Error("LEADERBOARD_INVALID_DATES");
  }
  if (input.start_at >= input.end_at) throw new Error("LEADERBOARD_INVALID_RANGE");

  const { data: rows, error } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .eq("id", leaderboardId)
    .limit(1);
  if (error) throw error;

  const current = rows?.[0];
  if (!current) throw new Error("LEADERBOARD_NOT_FOUND");
  if (current.status === "in_review" || current.status === "closed") {
    throw new Error("LEADERBOARD_LOCKED_FOR_EDIT");
  }

  const prizes = normalizePrizes(input.prizes);
  await assertLeaderboardWindowNoOverlap(input.start_at, input.end_at, leaderboardId);

  const nextStatus: TikTokLeaderboardStatus =
    current.status === "cancelled"
      ? "cancelled"
      : input.end_at <= now
        ? "in_review"
        : input.start_at <= now
          ? "active"
          : "scheduled";

  const { error: updateError } = await supabase
    .from("tiktok_leaderboards")
    .update({
      title,
      description: input.description?.trim() || null,
      start_at: input.start_at,
      end_at: input.end_at,
      status: nextStatus,
      updated_at: now,
    })
    .eq("id", leaderboardId);

  if (updateError) throw updateError;

  const { error: deletePrizesError } = await supabase
    .from("tiktok_leaderboard_prizes")
    .delete()
    .eq("leaderboard_id", leaderboardId);

  if (deletePrizesError) throw deletePrizesError;

  const { error: insertPrizesError } = await supabase.from("tiktok_leaderboard_prizes").insert(
    prizes.map((prize) => ({
      leaderboard_id: leaderboardId,
      position: prize.position,
      reward: prize.reward,
      created_at: now,
    }))
  );

  if (insertPrizesError) throw insertPrizesError;
}

export async function setTikTokLeaderboardStatus(
  leaderboardId: number,
  status: TikTokLeaderboardStatus,
  reviewNotes?: string
) {
  const now = Math.floor(Date.now() / 1000);
  const { error } = await supabase
    .from("tiktok_leaderboards")
    .update({ status, review_notes: reviewNotes?.trim() || null, updated_at: now })
    .eq("id", leaderboardId);

  if (error) throw error;
}

export async function deleteTikTokLeaderboard(leaderboardId: number) {
  const { error } = await supabase.from("tiktok_leaderboards").delete().eq("id", leaderboardId);
  if (error) throw error;
}

export async function getLeaderboardRankingSnapshot(leaderboardId: number) {
  const { data, error } = await supabase
    .from("tiktok_leaderboard_results")
    .select("*, user:users!tiktok_leaderboard_results_user_id_fkey(username, image)")
    .eq("leaderboard_id", leaderboardId)
    .order("position", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    return {
      ...row,
      username: user?.username || null,
      user_image: user?.image || null,
    };
  });
}

export async function getTikTokLeaderboardResultById(resultId: number) {
  const { data, error } = await supabase
    .from("tiktok_leaderboard_results")
    .select(
      "*, leaderboard:tiktok_leaderboards!tiktok_leaderboard_results_leaderboard_id_fkey(id, title), user:users!tiktok_leaderboard_results_user_id_fkey(discord_id, email, username, image)"
    )
    .eq("id", resultId)
    .limit(1);

  if (error) throw error;

  const row = data?.[0];
  if (!row) return null;

  const leaderboard = Array.isArray(row.leaderboard) ? row.leaderboard[0] : row.leaderboard;
  const user = Array.isArray(row.user) ? row.user[0] : row.user;

  return {
    ...row,
    leaderboard: leaderboard || null,
    user: user || null,
  };
}

export async function getTikTokLeaderboardForVideoAssociation(leaderboardId: number) {
  const { data, error } = await supabase
    .from("tiktok_leaderboards")
    .select("id, title, start_at, end_at, status")
    .eq("id", leaderboardId)
    .limit(1);

  if (error) throw error;

  return data?.[0] ?? null;
}

export async function getLiveLeaderboardRanking(
  startAt: number,
  endAt: number,
  limit = 50,
  leaderboardId?: number
) {
  let query = supabase
    .from("user_tiktok_videos")
    .select("*, user:users!user_tiktok_videos_user_id_fkey(username, image)")
    .eq("is_banned", false)
    .order("view_count", { ascending: false })
    .order("associated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (typeof leaderboardId === "number") {
    query = query.or(
      `leaderboard_id.eq.${leaderboardId},and(leaderboard_id.is.null,associated_at.gte.${startAt},associated_at.lte.${endAt})`
    );
  } else {
    query = query.gte("associated_at", startAt).lte("associated_at", endAt);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data || []).map((row) => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    return {
      user_id: row.user_id,
      username: user?.username || null,
      user_image: user?.image || null,
      video_row_id: row.id,
      video_id: row.video_id,
      video_title: row.title,
      video_cover_image_url: row.cover_image_url,
      video_share_url: row.share_url,
      view_count: row.view_count,
      like_count: row.like_count,
      comment_count: row.comment_count,
      share_count: row.share_count,
      associated_at: row.associated_at,
    };
  });
}

export async function getActiveLeaderboardVideoCandidates() {
  const now = Math.floor(Date.now() / 1000);

  const { data: activeBoards, error } = await supabase
    .from("tiktok_leaderboards")
    .select("id, start_at, end_at, status")
    .neq("status", "cancelled")
    .lte("start_at", now)
    .gt("end_at", now);

  if (error) throw error;

  const candidates = await Promise.all(
    (activeBoards || []).map(async (board) => {
      const ranking = await getLiveLeaderboardRanking(
        board.start_at,
        board.end_at,
        500,
        board.id
      );
      return ranking.map((row) => ({
        leaderboard_id: board.id,
        video_row_id: row.video_row_id,
        video_id: row.video_id,
        user_id: row.user_id,
      }));
    })
  );

  const unique = new Map<number, (typeof candidates)[number][number]>();
  for (const boardVideos of candidates) {
    for (const video of boardVideos) {
      if (!unique.has(video.video_row_id)) unique.set(video.video_row_id, video);
    }
  }

  return Array.from(unique.values());
}

export async function getAdminTikTokLeaderboards() {
  const { data: rows, error } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .order("start_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const ids = (rows || []).map((row) => row.id);
  if (ids.length === 0) return [];

  const [{ data: prizes }, { data: results }] = await Promise.all([
    supabase
      .from("tiktok_leaderboard_prizes")
      .select("*")
      .in("leaderboard_id", ids)
      .order("position", { ascending: true }),
    supabase
      .from("tiktok_leaderboard_results")
      .select("*, user:users!tiktok_leaderboard_results_user_id_fkey(username, image)")
      .in("leaderboard_id", ids)
      .order("position", { ascending: true }),
  ]);

  return (rows || []).map((row) => ({
    ...row,
    prizes: (prizes || [])
      .filter((prize) => prize.leaderboard_id === row.id)
      .map((prize) => ({ id: prize.id, position: prize.position, reward: prize.reward })),
    results: (results || [])
      .filter((result) => result.leaderboard_id === row.id)
      .map((result) => {
        const user = Array.isArray(result.user) ? result.user[0] : result.user;
        return {
          ...result,
          username: user?.username || null,
          user_image: user?.image || null,
        };
      }),
  }));
}

export async function getPublicTikTokLeaderboards() {
  const now = Math.floor(Date.now() / 1000);

  const { data: rows, error } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .neq("status", "cancelled")
    .order("start_at", { ascending: false });

  if (error) throw error;

  const withPayload = await Promise.all(
    (rows || []).map(async (row) => {
      const { data: prizes } = await supabase
        .from("tiktok_leaderboard_prizes")
        .select("position, reward")
        .eq("leaderboard_id", row.id)
        .order("position", { ascending: true });

      const ranking =
        row.status === "in_review" || row.status === "closed"
          ? await getLeaderboardRankingSnapshot(row.id)
          : await getLiveLeaderboardRanking(row.start_at, row.end_at, 25, row.id);

      const isActiveWindow = row.start_at <= now && row.end_at > now;

      return {
        ...row,
        prizes: prizes || [],
        ranking,
        is_active: row.status === "active" || (row.status === "scheduled" && isActiveWindow),
      };
    })
  );

  return {
    active: withPayload.filter((row) => row.is_active),
    past: withPayload.filter((row) => !row.is_active),
  };
}

export async function getPublicTikTokLeaderboardById(leaderboardId: number) {
  const now = Math.floor(Date.now() / 1000);

  const { data: rows, error } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .eq("id", leaderboardId)
    .neq("status", "cancelled")
    .limit(1);

  if (error) throw error;

  const row = rows?.[0];
  if (!row) return null;

  const [prizes, ranking, snapshots] = await Promise.all([
    supabase
      .from("tiktok_leaderboard_prizes")
      .select("position, reward")
      .eq("leaderboard_id", row.id)
      .order("position", { ascending: true })
      .then((r) => r.data || []),
    getLiveLeaderboardRanking(row.start_at, row.end_at, 500, row.id),
    getLeaderboardRankingSnapshot(row.id),
  ]);

  const isActiveWindow = row.start_at <= now && row.end_at > now;

  return {
    ...row,
    prizes,
    ranking,
    snapshots,
    is_active: row.status === "active" || (row.status === "scheduled" && isActiveWindow),
  };
}

export async function updateTikTokLeaderboardResultReview(params: {
  resultId: number;
  status: "pending_review" | "approved" | "rejected" | "prize_delivered" | "disqualified";
  reviewNote?: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const { data: updated, error } = await supabase
    .from("tiktok_leaderboard_results")
    .update({
      status: params.status,
      review_note: params.reviewNote?.trim() || null,
      updated_at: now,
    })
    .eq("id", params.resultId)
    .select("*");

  if (error) throw error;

  return updated?.[0] ?? null;
}

export async function disqualifyAndReallocateTikTokLeaderboardResult(params: {
  resultId: number;
  reviewNote?: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const { data: currentRows, error } = await supabase
    .from("tiktok_leaderboard_results")
    .select("*")
    .eq("id", params.resultId)
    .limit(1);

  if (error) throw error;

  const current = currentRows?.[0];
  if (!current) throw new Error("RESULT_NOT_FOUND");
  if (current.status === "disqualified") throw new Error("RESULT_ALREADY_DISQUALIFIED");

  const { error: disqualifyError } = await supabase
    .from("tiktok_leaderboard_results")
    .update({
      status: "disqualified",
      review_note: params.reviewNote?.trim() || "Usuario descalificado manualmente.",
      updated_at: now,
    })
    .eq("id", params.resultId);

  if (disqualifyError) throw disqualifyError;

  const { data: boardRows, error: boardError } = await supabase
    .from("tiktok_leaderboards")
    .select("id, reallocation_count")
    .eq("id", current.leaderboard_id)
    .limit(1);

  if (boardError) throw boardError;

  const board = boardRows?.[0];
  if (board) {
    await supabase
      .from("tiktok_leaderboards")
      .update({ has_reallocation: true, reallocation_count: (board.reallocation_count || 0) + 1, updated_at: now })
      .eq("id", board.id);
  }
}

export async function processTikTokLeaderboardsTick() {
  const now = Math.floor(Date.now() / 1000);

  const { data: activations, error: activationError } = await supabase
    .from("tiktok_leaderboards")
    .update({ status: "active", updated_at: now })
    .eq("status", "scheduled")
    .lte("start_at", now)
    .gt("end_at", now)
    .select("id");

  if (activationError) throw activationError;

  const { data: toFinalize, error: toFinalizeError } = await supabase
    .from("tiktok_leaderboards")
    .select("*")
    .lte("end_at", now)
    .in("status", ["scheduled", "active"]);

  if (toFinalizeError) throw toFinalizeError;

  let finalized = 0;

  for (const board of toFinalize || []) {
    const { data: prizes } = await supabase
      .from("tiktok_leaderboard_prizes")
      .select("*")
      .eq("leaderboard_id", board.id)
      .order("position", { ascending: true });

    const maxPosition = (prizes || []).reduce((max, prize) => Math.max(max, prize.position), 0);
    const ranking = maxPosition > 0
      ? await getLiveLeaderboardRanking(board.start_at, board.end_at, maxPosition, board.id)
      : [];

    await supabase.from("tiktok_leaderboard_results").delete().eq("leaderboard_id", board.id);

    if ((prizes || []).length > 0 && ranking.length > 0) {
      const rows = (prizes || [])
        .map((prize) => {
          const ranked = ranking[prize.position - 1];
          if (!ranked) return null;
          return {
            leaderboard_id: board.id,
            position: prize.position,
            user_id: ranked.user_id,
            video_row_id: ranked.video_row_id,
            video_id: ranked.video_id,
            video_title: ranked.video_title,
            video_cover_image_url: ranked.video_cover_image_url,
            video_share_url: ranked.video_share_url,
            view_count: ranked.view_count,
            like_count: ranked.like_count,
            comment_count: ranked.comment_count,
            share_count: ranked.share_count,
            reward: prize.reward,
            status: "pending_review",
            review_note: null,
            created_at: now,
            updated_at: now,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (rows.length > 0) {
        await supabase.from("tiktok_leaderboard_results").insert(rows);
      }
    }

    await supabase
      .from("tiktok_leaderboards")
      .update({ status: "in_review", finalized_at: now, updated_at: now })
      .eq("id", board.id);

    finalized += 1;
  }

  return {
    activated: (activations || []).length,
    finalized,
  };
}
