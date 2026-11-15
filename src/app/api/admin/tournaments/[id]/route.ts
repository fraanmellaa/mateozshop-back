import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorized, requireAdmin } from "@/app/utils/auth";
import { GameError } from "@/app/utils/games/errors";
import { getTournamentAdmin } from "@/app/utils/games/tournament";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return adminUnauthorized();

  const { id } = await params;
  const tournamentId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ success: false, error: "INVALID_ID" }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, data: await getTournamentAdmin(tournamentId) });
  } catch (error) {
    if (error instanceof GameError) {
      return NextResponse.json({ success: false, error: error.code }, { status: error.status });
    }
    console.error("Error loading tournament:", error);
    return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
