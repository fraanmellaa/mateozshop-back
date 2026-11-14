import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import {
  deleteTikTokLeaderboard,
  getAdminTikTokLeaderboards,
  setTikTokLeaderboardStatus,
  updateTikTokLeaderboard,
} from "@/app/utils/tiktok/leaderboards";
import { purgePastLeaderboardsCache } from "@/app/utils/frontendCache";

const VALIDATION_ERRORS = new Set([
  "LEADERBOARD_TITLE_REQUIRED",
  "LEADERBOARD_INVALID_DATES",
  "LEADERBOARD_INVALID_RANGE",
  "LEADERBOARD_END_IN_PAST",
  "LEADERBOARD_PRIZES_REQUIRED",
  "LEADERBOARD_PRIZES_DUPLICATED_POSITION",
  "LEADERBOARD_OVERLAP_NOT_ALLOWED",
]);

// El estado actual no admite la operación.
const CONFLICT_ERRORS = new Set([
  "LEADERBOARD_LOCKED_FOR_EDIT",
  "LEADERBOARD_INVALID_TRANSITION",
]);

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function invalidId() {
  return NextResponse.json(
    { success: false, error: "INVALID_LEADERBOARD_ID" },
    { status: 400 }
  );
}

async function purgeCache() {
  try {
    await purgePastLeaderboardsCache();
  } catch (error) {
    console.error("Error purgando caché de leaderboards:", error);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const id = parseId((await params).id);
    if (id === null) return invalidId();

    const all = await getAdminTikTokLeaderboards();
    const leaderboard = all.find((item) => item.id === id);

    if (!leaderboard) {
      return NextResponse.json(
        { success: false, error: "LEADERBOARD_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, result: leaderboard });
  } catch (error) {
    console.error("Error fetching TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const id = parseId((await params).id);
    if (id === null) return invalidId();

    const body = await request.json().catch(() => null);

    if (body?.action === "set_status") {
      const status = String(body?.status || "");

      // Lo único que decide el admin: cerrar la revisión o cancelar. El resto
      // de cambios de estado los hace el cron.
      if (status !== "closed" && status !== "cancelled") {
        return NextResponse.json(
          { success: false, error: "INVALID_LEADERBOARD_STATUS" },
          { status: 400 }
        );
      }

      await setTikTokLeaderboardStatus(
        id,
        status,
        typeof body?.review_notes === "string" ? body.review_notes : undefined
      );

      await purgeCache();

      return NextResponse.json({ success: true });
    }

    await updateTikTokLeaderboard(id, {
      title: String(body?.title || ""),
      description: body?.description ? String(body.description) : null,
      start_at: Number(body?.start_at),
      end_at: Number(body?.end_at),
      prizes: Array.isArray(body?.prizes) ? body.prizes : [],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "LEADERBOARD_NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    if (CONFLICT_ERRORS.has(message)) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 409 }
      );
    }

    if (VALIDATION_ERRORS.has(message)) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    console.error("Error updating TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return adminUnauthorized();

  try {
    const id = parseId((await params).id);
    if (id === null) return invalidId();

    await deleteTikTokLeaderboard(id);
    await purgeCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "LEADERBOARD_NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: "LEADERBOARD_NOT_FOUND" },
        { status: 404 }
      );
    }

    console.error("Error deleting TikTok leaderboard:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}
