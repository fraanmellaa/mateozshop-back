import { NextRequest } from "next/server";

import { getMonthlyLeaderboard } from "@/app/utils/economy/leaderboard";
import { adMonth } from "@/app/utils/economy/time";
import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { extensionOk } from "@/app/utils/games/http";
import { getGiveaways } from "@/app/utils/giveaways";
import { getProducts } from "@/app/utils/products";

type PublicSummary = {
  auctions: { name: string; currentBid: number; minNextBid: number; endsAt: number | null }[];
  auctionsWaiting: number;
  giveaways: { title: string; cost: number; endsAt: number; tickets: number }[];
};

// La parte común a todos (pujas y sorteos) se reutiliza 30 s.
const TTL_MS = 30_000;
let cache: { value: PublicSummary; expiresAt: number } | null = null;

async function publicSummary(): Promise<PublicSummary> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const [products, giveaways] = await Promise.allSettled([getProducts(), getGiveaways()]);
  if (products.status === "rejected") console.error("Extension summary: products unavailable:", products.reason);
  if (giveaways.status === "rejected") console.error("Extension summary: giveaways unavailable:", giveaways.reason);

  const list = products.status === "fulfilled" ? products.value : [];
  const actual = giveaways.status === "fulfilled" ? giveaways.value.actual : [];

  const value: PublicSummary = {
    auctions: list
      .filter((p) => p.auction_status === "in_progress")
      .sort((a, b) => (a.auction_ends_at ?? 0) - (b.auction_ends_at ?? 0))
      .slice(0, 4)
      .map((p) => ({
        name: p.name,
        currentBid: p.current_bid,
        minNextBid: p.min_next_bid,
        endsAt: p.auction_ends_at,
      })),
    auctionsWaiting: list.filter((p) => p.auction_status === "waiting" && p.stock > 0).length,
    giveaways: actual
      .sort((a, b) => a.end_at - b.end_at)
      .slice(0, 4)
      .map((g) => {
        // `title` y `cost` vienen de la fila pública, que el listado no tipa.
        const row = g as typeof g & { title?: unknown; cost?: unknown };
        return {
          title: String(row.title ?? ""),
          cost: Number(row.cost ?? 0) || 0,
          endsAt: g.end_at,
          tickets: g.entries_count,
        };
      }),
  };

  // Si algo falló no se guarda: la siguiente petición lo reintenta.
  if (products.status === "fulfilled" && giveaways.status === "fulfilled") {
    cache = { value, expiresAt: Date.now() + TTL_MS };
  }
  return value;
}

// Resumen de solo lectura para la pestaña "Explorar": posición en el ranking
// mensual, premios en puja y sorteos abiertos. Pujar y participar, en la web.
export async function GET(request: NextRequest) {
  const auth = await requireExtensionUser(request);
  if (!auth.ok) return auth.response;

  const [board, common] = await Promise.all([
    getMonthlyLeaderboard(adMonth(), auth.user.id).catch((error) => {
      console.error("Extension summary: leaderboard unavailable:", error);
      return null;
    }),
    publicSummary(),
  ]);

  return extensionOk({
    leaderboard: board
      ? {
          month: board.month,
          me: board.me,
          top: board.entries.slice(0, 3).map((e) => ({
            position: e.position,
            username: e.username,
            points: e.points,
          })),
        }
      : null,
    ...common,
    now: Math.floor(Date.now() / 1000),
  });
}
