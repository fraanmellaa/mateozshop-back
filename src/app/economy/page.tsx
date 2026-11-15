import { SiteHeader } from "../components/Header";
import { getMonthlyLeaderboard } from "../utils/economy/leaderboard";
import { getLastReset } from "../utils/economy/monthly";
import { DEFAULT_ECONOMY_SETTINGS } from "../utils/economy/schema";
import { getEconomySettings } from "../utils/economy/settings";
import { adMonth } from "../utils/economy/time";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  const month = adMonth();
  const [settings, lastReset, board] = await Promise.all([
    getEconomySettings(),
    getLastReset(),
    getMonthlyLeaderboard(month).catch((error) => {
      console.error("Error loading leaderboard preview:", error);
      return null;
    }),
  ]);

  return (
    <div className="p-6">
      <SiteHeader title="Economía de puntos" />
      <PageBody
        settings={settings}
        defaults={DEFAULT_ECONOMY_SETTINGS}
        month={month}
        board={board?.entries ?? null}
        lastReset={lastReset}
      />
    </div>
  );
}
