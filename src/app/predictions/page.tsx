import { SiteHeader } from "../components/Header";
import { getAllPredictions, getPredictionSettings } from "../utils/predictions";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const [predictions, settings] = await Promise.all([
    getAllPredictions(),
    getPredictionSettings(),
  ]);

  return (
    <div className="p-6">
      <SiteHeader title="Pronósticos deportivos" />
      <PageBody predictions={predictions} settings={settings} />
    </div>
  );
}
