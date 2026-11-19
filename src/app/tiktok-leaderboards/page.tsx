import { Suspense } from "react";

import { SiteHeader } from "../components/Header";
import { adMonth } from "../utils/economy/time";
import { getAdminTikTokLeaderboards } from "../utils/tiktok/leaderboards";
import { getTikTokMonthPrizes } from "../utils/tiktok/monthPrizes";
import MonthPrizes from "./MonthPrizes";
import PageBody from "./PageBody";

export default async function TikTokLeaderboardsPage() {
  const [leaderboards, monthPrizes] = await Promise.all([
    getAdminTikTokLeaderboards(),
    getTikTokMonthPrizes(adMonth()),
  ]);

  return (
    <div className="p-6">
      <SiteHeader title="TikTok Leaderboards" />
      <Suspense fallback={<div>Cargando leaderboards...</div>}>
        <PageBody initialLeaderboards={leaderboards} />
      </Suspense>
      <MonthPrizes initial={monthPrizes} />
    </div>
  );
}
