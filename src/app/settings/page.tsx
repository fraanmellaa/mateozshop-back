import { SiteHeader } from "../components/Header";
import { getExtensionSettings } from "../utils/settings";
import { DEFAULT_EXTENSION_SETTINGS } from "../utils/settings/schema";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getExtensionSettings();

  return (
    <div className="p-6">
      <SiteHeader title="Ajustes de la extensión" />
      <PageBody settings={settings} defaults={DEFAULT_EXTENSION_SETTINGS} />
    </div>
  );
}
