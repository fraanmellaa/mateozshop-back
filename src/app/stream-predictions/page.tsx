import { SiteHeader } from "../components/Header";
import { getStreamPredictionSettings, listStreamPredictions } from "../utils/streamPredictions";

import PageBody from "./PageBody";
import { requireAdminPage } from "@/app/utils/auth";

export const dynamic = "force-dynamic";

// Predicciones del directo (no son los Pronósticos deportivos de /predictions).
export default async function StreamPredictionsPage() {
  await requireAdminPage();
  const [list, settings] = await Promise.all([listStreamPredictions(), getStreamPredictionSettings()]);

  return (
    <div className="p-6">
      <SiteHeader title="Predicciones del directo" />
      <PageBody available={list.available} predictions={list.items} settings={settings} />
    </div>
  );
}
