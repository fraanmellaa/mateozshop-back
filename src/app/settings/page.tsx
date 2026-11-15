import { SiteHeader } from "../components/Header";
import { getGamesSettings } from "../utils/settings";
import { DEFAULT_GAMES_SETTINGS } from "../utils/settings/schema";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getGamesSettings();

  return (
    <div className="p-6">
      <SiteHeader title="Ajustes de los juegos" />
      <PageBody settings={settings} defaults={DEFAULT_GAMES_SETTINGS} />
    </div>
  );
}
