import { Suspense } from "react";

import { SiteHeader } from "../components/Header";
import { STATS_MIGRATION_ERROR, getAdminStats, type AdminStats } from "../utils/stats";
import PageBody from "./PageBody";
import { requireAdminPage } from "@/app/utils/auth";

export const dynamic = "force-dynamic";

// Números de la economía: una fila por semana y otra por mes con los puntos
// repartidos y gastados y los premios puestos y vendidos.
export default async function StatsPage() {
  await requireAdminPage();
  let weeks: AdminStats | null = null;
  let months: AdminStats | null = null;
  let error: string | null = null;
  try {
    [weeks, months] = await Promise.all([getAdminStats("week"), getAdminStats("month")]);
    if (!weeks || !months) error = STATS_MIGRATION_ERROR;
  } catch (failure) {
    console.error("Error loading admin stats:", failure);
    error = "No se han podido cargar los números. Vuelve a intentarlo.";
  }

  return (
    <div className="p-6">
      <SiteHeader title="Números" />
      <Suspense fallback={<div>Cargando números...</div>}>
        <PageBody weeks={weeks} months={months} error={error} />
      </Suspense>
    </div>
  );
}
