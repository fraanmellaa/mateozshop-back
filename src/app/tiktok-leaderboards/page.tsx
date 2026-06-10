import { Suspense } from "react";

import { SiteHeader } from "../components/Header";
import { getAdminTikTokLeaderboards } from "../utils/tiktok/leaderboards";
import PageBody from "./PageBody";

export default async function TikTokLeaderboardsPage() {
  const leaderboards = await getAdminTikTokLeaderboards();

  return (
    <div className="p-6">
      <SiteHeader title="TikTok Leaderboards" />
      <Suspense fallback={<div>Cargando leaderboards...</div>}>
        <PageBody initialLeaderboards={leaderboards} />
      </Suspense>
    </div>
  );
}
