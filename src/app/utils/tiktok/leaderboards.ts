"use server";

import { db } from "@/db/drizzle";
import {
  tiktok_leaderboards,
  tiktok_leaderboard_prizes,
  tiktok_leaderboard_results,
  user_tiktok_videos,
  users,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

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

async function assertLeaderboardWindowNoOverlap(
  startAt: number,
  endAt: number,
  exceptId?: number
) {
  const conflicting = await db
    .select({ id: tiktok_leaderboards.id })
    .from(tiktok_leaderboards)
    .where(
      sql`
        ${tiktok_leaderboards.status} <> 'cancelled'
        and (${exceptId ? sql`${tiktok_leaderboards.id} <> ${exceptId}` : sql`true`})
        and not (${tiktok_leaderboards.end_at} <= ${startAt} or ${tiktok_leaderboards.start_at} >= ${endAt})
      `
    )
    .limit(1);

  if (conflicting.length > 0) {
    throw new Error("LEADERBOARD_OVERLAP_NOT_ALLOWED");
  }
}

export async function createTikTokLeaderboard(input: TikTokLeaderboardInput) {
  const now = Math.floor(Date.now() / 1000);
  const title = input.title.trim();

  if (!title) {
    throw new Error("LEADERBOARD_TITLE_REQUIRED");
  }

  if (!Number.isInteger(input.start_at) || !Number.isInteger(input.end_at)) {
    throw new Error("LEADERBOARD_INVALID_DATES");
  }

  if (input.start_at >= input.end_at) {
    throw new Error("LEADERBOARD_INVALID_RANGE");
  }

  const prizes = normalizePrizes(input.prizes);
  await assertLeaderboardWindowNoOverlap(input.start_at, input.end_at);

  const status: TikTokLeaderboardStatus =
    input.end_at <= now
      ? "in_review"
      : input.start_at <= now
        ? "active"
        : "scheduled";

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tiktok_leaderboards)
      .values({
        title,
        description: input.description?.trim() || null,
        start_at: input.start_at,
        end_at: input.end_at,
        status,
        finalized_at: status === "in_review" ? now : null,
        created_at: now,
        updated_at: now,
      })
      .returning();

    const leaderboard = inserted[0];

    await tx.insert(tiktok_leaderboard_prizes).values(
      prizes.map((prize) => ({
        leaderboard_id: leaderboard.id,
        position: prize.position,
        reward: prize.reward,
        created_at: now,
      }))
    );

    return leaderboard;
  });

  return created;
}

export async function updateTikTokLeaderboard(
  leaderboardId: number,
  input: TikTokLeaderboardInput
) {
  const now = Math.floor(Date.now() / 1000);
  const title = input.title.trim();

  if (!title) {
    throw new Error("LEADERBOARD_TITLE_REQUIRED");
  }

  if (!Number.isInteger(input.start_at) || !Number.isInteger(input.end_at)) {
    throw new Error("LEADERBOARD_INVALID_DATES");
  }

  if (input.start_at >= input.end_at) {
    throw new Error("LEADERBOARD_INVALID_RANGE");
  }

  const leaderboardRows = await db
    .select()
    .from(tiktok_leaderboards)
    .where(eq(tiktok_leaderboards.id, leaderboardId))
    .limit(1);

  const current = leaderboardRows[0];
  if (!current) {
    throw new Error("LEADERBOARD_NOT_FOUND");
  }

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

  await db.transaction(async (tx) => {
    await tx
      .update(tiktok_leaderboards)
      .set({
        title,
        description: input.description?.trim() || null,
        start_at: input.start_at,
        end_at: input.end_at,
        status: nextStatus,
        updated_at: now,
      })
      .where(eq(tiktok_leaderboards.id, leaderboardId));

    await tx
      .delete(tiktok_leaderboard_prizes)
      .where(eq(tiktok_leaderboard_prizes.leaderboard_id, leaderboardId));

    await tx.insert(tiktok_leaderboard_prizes).values(
      prizes.map((prize) => ({
        leaderboard_id: leaderboardId,
        position: prize.position,
        reward: prize.reward,
        created_at: now,
      }))
    );
  });
}

export async function setTikTokLeaderboardStatus(
  leaderboardId: number,
  status: TikTokLeaderboardStatus,
  reviewNotes?: string
) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(tiktok_leaderboards)
    .set({
      status,
      review_notes: reviewNotes?.trim() || null,
      updated_at: now,
    })
    .where(eq(tiktok_leaderboards.id, leaderboardId));
}

export async function deleteTikTokLeaderboard(leaderboardId: number) {
  await db
    .delete(tiktok_leaderboards)
    .where(eq(tiktok_leaderboards.id, leaderboardId));
}

export async function getLeaderboardRankingSnapshot(leaderboardId: number) {
  return db
    .select({
      id: tiktok_leaderboard_results.id,
      leaderboard_id: tiktok_leaderboard_results.leaderboard_id,
      position: tiktok_leaderboard_results.position,
      user_id: tiktok_leaderboard_results.user_id,
      username: users.username,
      user_image: users.image,
      video_row_id: tiktok_leaderboard_results.video_row_id,
      video_id: tiktok_leaderboard_results.video_id,
      video_title: tiktok_leaderboard_results.video_title,
      video_cover_image_url: tiktok_leaderboard_results.video_cover_image_url,
      video_share_url: tiktok_leaderboard_results.video_share_url,
      view_count: tiktok_leaderboard_results.view_count,
      like_count: tiktok_leaderboard_results.like_count,
      comment_count: tiktok_leaderboard_results.comment_count,
      share_count: tiktok_leaderboard_results.share_count,
      reward: tiktok_leaderboard_results.reward,
      status: tiktok_leaderboard_results.status,
      review_note: tiktok_leaderboard_results.review_note,
      created_at: tiktok_leaderboard_results.created_at,
      updated_at: tiktok_leaderboard_results.updated_at,
    })
    .from(tiktok_leaderboard_results)
    .innerJoin(users, eq(users.id, tiktok_leaderboard_results.user_id))
    .where(eq(tiktok_leaderboard_results.leaderboard_id, leaderboardId))
    .orderBy(asc(tiktok_leaderboard_results.position));
}

export async function getLiveLeaderboardRanking(
  startAt: number,
  endAt: number,
  limit = 50
) {
  return db
    .select({
      user_id: user_tiktok_videos.user_id,
      username: users.username,
      user_image: users.image,
      video_row_id: user_tiktok_videos.id,
      video_id: user_tiktok_videos.video_id,
      video_title: user_tiktok_videos.title,
      video_cover_image_url: user_tiktok_videos.cover_image_url,
      video_share_url: user_tiktok_videos.share_url,
      view_count: user_tiktok_videos.view_count,
      like_count: user_tiktok_videos.like_count,
      comment_count: user_tiktok_videos.comment_count,
      share_count: user_tiktok_videos.share_count,
      associated_at: user_tiktok_videos.associated_at,
    })
    .from(user_tiktok_videos)
    .innerJoin(users, eq(users.id, user_tiktok_videos.user_id))
    .where(
      and(
        eq(user_tiktok_videos.is_banned, false),
        sql`${user_tiktok_videos.associated_at} >= ${startAt}`,
        sql`${user_tiktok_videos.associated_at} <= ${endAt}`
      )
    )
    .orderBy(desc(user_tiktok_videos.view_count), asc(user_tiktok_videos.associated_at), asc(user_tiktok_videos.id))
    .limit(limit);
}

export async function getActiveLeaderboardVideoCandidates() {
  const now = Math.floor(Date.now() / 1000);

  const activeBoards = await db
    .select({
      id: tiktok_leaderboards.id,
      start_at: tiktok_leaderboards.start_at,
      end_at: tiktok_leaderboards.end_at,
    })
    .from(tiktok_leaderboards)
    .where(
      and(
        ne(tiktok_leaderboards.status, "cancelled"),
        sql`${tiktok_leaderboards.start_at} <= ${now}`,
        sql`${tiktok_leaderboards.end_at} > ${now}`
      )
    );

  if (activeBoards.length === 0) {
    return [];
  }

  const candidates = await Promise.all(
    activeBoards.map(async (board) => {
      const videos = await db
        .select({
          leaderboard_id: sql<number>`${board.id}`,
          video_row_id: user_tiktok_videos.id,
          video_id: user_tiktok_videos.video_id,
          user_id: user_tiktok_videos.user_id,
        })
        .from(user_tiktok_videos)
        .where(
          and(
            eq(user_tiktok_videos.is_banned, false),
            sql`${user_tiktok_videos.associated_at} >= ${board.start_at}`,
            sql`${user_tiktok_videos.associated_at} <= ${board.end_at}`
          )
        )
        .orderBy(
          desc(user_tiktok_videos.view_count),
          asc(user_tiktok_videos.associated_at),
          asc(user_tiktok_videos.id)
        );

      return videos;
    })
  );

  const unique = new Map<number, (typeof candidates)[number][number]>();

  for (const boardVideos of candidates) {
    for (const video of boardVideos) {
      if (!unique.has(video.video_row_id)) {
        unique.set(video.video_row_id, video);
      }
    }
  }

  return Array.from(unique.values());
}

export async function getAdminTikTokLeaderboards() {
  const rows = await db
    .select()
    .from(tiktok_leaderboards)
    .orderBy(desc(tiktok_leaderboards.start_at), desc(tiktok_leaderboards.id));

  const boardIds = rows.map((row) => row.id);
  if (boardIds.length === 0) {
    return [];
  }

  const [prizes, results] = await Promise.all([
    db
      .select()
      .from(tiktok_leaderboard_prizes)
      .where(inArray(tiktok_leaderboard_prizes.leaderboard_id, boardIds))
      .orderBy(asc(tiktok_leaderboard_prizes.position)),
    db
      .select({
        id: tiktok_leaderboard_results.id,
        leaderboard_id: tiktok_leaderboard_results.leaderboard_id,
        position: tiktok_leaderboard_results.position,
        user_id: tiktok_leaderboard_results.user_id,
        username: users.username,
        user_image: users.image,
        video_id: tiktok_leaderboard_results.video_id,
        video_title: tiktok_leaderboard_results.video_title,
        video_cover_image_url: tiktok_leaderboard_results.video_cover_image_url,
        video_share_url: tiktok_leaderboard_results.video_share_url,
        view_count: tiktok_leaderboard_results.view_count,
        like_count: tiktok_leaderboard_results.like_count,
        comment_count: tiktok_leaderboard_results.comment_count,
        share_count: tiktok_leaderboard_results.share_count,
        reward: tiktok_leaderboard_results.reward,
        status: tiktok_leaderboard_results.status,
        review_note: tiktok_leaderboard_results.review_note,
      })
      .from(tiktok_leaderboard_results)
      .innerJoin(users, eq(users.id, tiktok_leaderboard_results.user_id))
      .where(inArray(tiktok_leaderboard_results.leaderboard_id, boardIds))
      .orderBy(asc(tiktok_leaderboard_results.position)),
  ]);

  return rows.map((row) => ({
    ...row,
    prizes: prizes
      .filter((prize) => prize.leaderboard_id === row.id)
      .map((prize) => ({
        id: prize.id,
        position: prize.position,
        reward: prize.reward,
      })),
    results: results.filter((result) => result.leaderboard_id === row.id),
  }));
}

export async function getPublicTikTokLeaderboards() {
  const now = Math.floor(Date.now() / 1000);

  const rows = await db
    .select()
    .from(tiktok_leaderboards)
    .where(ne(tiktok_leaderboards.status, "cancelled"))
    .orderBy(desc(tiktok_leaderboards.start_at));

  const withPayload = await Promise.all(
    rows.map(async (row) => {
      const prizes = await db
        .select({
          position: tiktok_leaderboard_prizes.position,
          reward: tiktok_leaderboard_prizes.reward,
        })
        .from(tiktok_leaderboard_prizes)
        .where(eq(tiktok_leaderboard_prizes.leaderboard_id, row.id))
        .orderBy(asc(tiktok_leaderboard_prizes.position));

      let ranking;
      if (row.status === "in_review" || row.status === "closed") {
        ranking = await getLeaderboardRankingSnapshot(row.id);
      } else {
        ranking = await getLiveLeaderboardRanking(row.start_at, row.end_at, 25);
      }

      const isActiveWindow = row.start_at <= now && row.end_at > now;

      return {
        ...row,
        prizes,
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

  const rows = await db
    .select()
    .from(tiktok_leaderboards)
    .where(
      and(
        eq(tiktok_leaderboards.id, leaderboardId),
        ne(tiktok_leaderboards.status, "cancelled")
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const [prizes, ranking, snapshots] = await Promise.all([
    db
      .select({
        position: tiktok_leaderboard_prizes.position,
        reward: tiktok_leaderboard_prizes.reward,
      })
      .from(tiktok_leaderboard_prizes)
      .where(eq(tiktok_leaderboard_prizes.leaderboard_id, row.id))
      .orderBy(asc(tiktok_leaderboard_prizes.position)),
    getLiveLeaderboardRanking(row.start_at, row.end_at, 500),
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
  status:
    | "pending_review"
    | "approved"
    | "rejected"
    | "prize_delivered"
    | "disqualified";
  reviewNote?: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const updated = await db
    .update(tiktok_leaderboard_results)
    .set({
      status: params.status,
      review_note: params.reviewNote?.trim() || null,
      updated_at: now,
    })
    .where(eq(tiktok_leaderboard_results.id, params.resultId))
    .returning();

  return updated[0] ?? null;
}

export async function disqualifyAndReallocateTikTokLeaderboardResult(params: {
  resultId: number;
  reviewNote?: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const currentRows = await db
    .select()
    .from(tiktok_leaderboard_results)
    .where(eq(tiktok_leaderboard_results.id, params.resultId))
    .limit(1);

  const current = currentRows[0];
  if (!current) {
    throw new Error("RESULT_NOT_FOUND");
  }

  if (current.status === "disqualified") {
    throw new Error("RESULT_ALREADY_DISQUALIFIED");
  }

  const boardRows = await db
    .select()
    .from(tiktok_leaderboards)
    .where(eq(tiktok_leaderboards.id, current.leaderboard_id))
    .limit(1);

  const board = boardRows[0];
  if (!board) {
    throw new Error("LEADERBOARD_NOT_FOUND");
  }

  const prizes = await db
    .select()
    .from(tiktok_leaderboard_prizes)
    .where(eq(tiktok_leaderboard_prizes.leaderboard_id, board.id))
    .orderBy(asc(tiktok_leaderboard_prizes.position));

  if (prizes.length === 0) {
    throw new Error("LEADERBOARD_PRIZES_REQUIRED");
  }

  const results = await db
    .select()
    .from(tiktok_leaderboard_results)
    .where(eq(tiktok_leaderboard_results.leaderboard_id, board.id));

  const disqualifiedUserIds = new Set<number>();
  for (const result of results) {
    if (result.status === "disqualified") {
      disqualifiedUserIds.add(result.user_id);
    }
  }
  disqualifiedUserIds.add(current.user_id);

  const maxPosition = prizes.reduce(
    (max, prize) => Math.max(max, prize.position),
    0
  );

  const ranking = await getLiveLeaderboardRanking(
    board.start_at,
    board.end_at,
    Math.max(maxPosition + disqualifiedUserIds.size + 20, 100)
  );

  const eligibleRanking = ranking.filter(
    (entry) => !disqualifiedUserIds.has(entry.user_id)
  );

  const awardedRows = prizes
    .map((prize) => {
      const ranked = eligibleRanking[prize.position - 1];
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
        review_note: "Reajustado por descalificacion previa",
        created_at: now,
        updated_at: now,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const existingDisqualified = results.filter(
    (result) => result.status === "disqualified"
  );

  const disqualifiedSnapshot = {
    leaderboard_id: board.id,
    position: current.position,
    user_id: current.user_id,
    video_row_id: current.video_row_id,
    video_id: current.video_id,
    video_title: current.video_title,
    video_cover_image_url: current.video_cover_image_url,
    video_share_url: current.video_share_url,
    view_count: current.view_count,
    like_count: current.like_count,
    comment_count: current.comment_count,
    share_count: current.share_count,
    reward: current.reward,
    status: "disqualified",
    review_note:
      params.reviewNote?.trim() ||
      "Usuario descalificado manualmente. Premio reasignado.",
    created_at: current.created_at,
    updated_at: now,
  };

  await db.transaction(async (tx) => {
    await tx
      .delete(tiktok_leaderboard_results)
      .where(eq(tiktok_leaderboard_results.leaderboard_id, board.id));

    const snapshots = [...existingDisqualified, disqualifiedSnapshot].map(
      (row) => ({
        ...row,
        id: undefined,
      })
    );

    const normalizedSnapshots = snapshots.map((row) => ({
      leaderboard_id: row.leaderboard_id,
      position: row.position,
      user_id: row.user_id,
      video_row_id: row.video_row_id,
      video_id: row.video_id,
      video_title: row.video_title,
      video_cover_image_url: row.video_cover_image_url,
      video_share_url: row.video_share_url,
      view_count: row.view_count,
      like_count: row.like_count,
      comment_count: row.comment_count,
      share_count: row.share_count,
      reward: row.reward,
      status: "disqualified" as const,
      review_note: row.review_note,
      created_at: row.created_at,
      updated_at: now,
    }));

    if (normalizedSnapshots.length > 0) {
      await tx.insert(tiktok_leaderboard_results).values(normalizedSnapshots);
    }

    if (awardedRows.length > 0) {
      await tx.insert(tiktok_leaderboard_results).values(awardedRows);
    }

    const baseReview = board.review_notes?.trim();
    const extra = `Reajustacion de puestos: ${new Date(now * 1000).toISOString()}`;
    const mergedReview = baseReview ? `${baseReview}\n${extra}` : extra;

    await tx
      .update(tiktok_leaderboards)
      .set({
        has_reallocation: true,
        reallocation_count: board.reallocation_count + 1,
        review_notes: mergedReview,
        updated_at: now,
      })
      .where(eq(tiktok_leaderboards.id, board.id));
  });
}

export async function processTikTokLeaderboardsTick() {
  const now = Math.floor(Date.now() / 1000);

  const activations = await db
    .update(tiktok_leaderboards)
    .set({
      status: "active",
      updated_at: now,
    })
    .where(
      and(
        eq(tiktok_leaderboards.status, "scheduled"),
        sql`${tiktok_leaderboards.start_at} <= ${now}`,
        sql`${tiktok_leaderboards.end_at} > ${now}`
      )
    )
    .returning({ id: tiktok_leaderboards.id });

  const toFinalize = await db
    .select()
    .from(tiktok_leaderboards)
    .where(
      and(
        sql`${tiktok_leaderboards.status} in ('scheduled', 'active')`,
        sql`${tiktok_leaderboards.end_at} <= ${now}`
      )
    );

  let finalized = 0;

  for (const board of toFinalize) {
    const prizes = await db
      .select()
      .from(tiktok_leaderboard_prizes)
      .where(eq(tiktok_leaderboard_prizes.leaderboard_id, board.id))
      .orderBy(asc(tiktok_leaderboard_prizes.position));

    const maxPosition = prizes.reduce((max, prize) => Math.max(max, prize.position), 0);

    const ranking = maxPosition > 0
      ? await getLiveLeaderboardRanking(board.start_at, board.end_at, maxPosition)
      : [];

    await db.transaction(async (tx) => {
      await tx
        .delete(tiktok_leaderboard_results)
        .where(eq(tiktok_leaderboard_results.leaderboard_id, board.id));

      if (prizes.length > 0 && ranking.length > 0) {
        const rankingByPosition = new Map<number, (typeof ranking)[number]>();
        ranking.forEach((entry, idx) => {
          rankingByPosition.set(idx + 1, entry);
        });

        const rows = prizes
          .map((prize) => {
            const ranked = rankingByPosition.get(prize.position);
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
          await tx.insert(tiktok_leaderboard_results).values(rows);
        }
      }

      await tx
        .update(tiktok_leaderboards)
        .set({
          status: "in_review",
          finalized_at: now,
          updated_at: now,
        })
        .where(eq(tiktok_leaderboards.id, board.id));
    });

    finalized += 1;
  }

  return {
    activated: activations.length,
    finalized,
  };
}
