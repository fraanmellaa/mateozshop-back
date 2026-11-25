import { SiteHeader } from "../components/Header";
import { listClassicPredictionsForAdmin } from "../utils/classicPredictions";
import { requireAdminPage } from "../utils/auth";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

// Predicciones (Classic): dos opciones, los usuarios ponen puntos y el bote se
// reparte entre los que aciertan. No son las Predicciones gratis de
// /stream-predictions ni los Pronósticos deportivos de /predictions.
export default async function ClassicPredictionsPage() {
  // El proxy ya filtra; cada página lo vuelve a comprobar antes de leer nada.
  await requireAdminPage();
  const initial = await listClassicPredictionsForAdmin();

  return (
    <div className="p-6">
      <SiteHeader title="Predicciones (Classic)" />
      <PageBody initial={initial} />
    </div>
  );
}
