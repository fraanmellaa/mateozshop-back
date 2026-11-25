import { Suspense } from "react";

import { SiteHeader } from "../components/Header";
import { VipUnavailableError } from "../utils/points/vip";
import { VIP_MIGRATION_ERROR } from "../utils/products/currency";
import { listVerificationRequests, type AdminVerificationRequest } from "../utils/verification";
import { getMinDepositByCasino } from "../utils/bonuses";
import { getCasinoFunnel, type CasinoFunnelRow } from "../utils/verification/stats";
import PageBody from "./PageBody";
import { requireAdminPage } from "@/app/utils/auth";

export const dynamic = "force-dynamic";

// Solicitudes de verificación de afiliados: el admin comprueba el usuario del
// casino y aprueba (el usuario pasa a verificado y gana puntos VIP) o rechaza.
export default async function VerificationsPage() {
  await requireAdminPage();
  let requests: AdminVerificationRequest[] = [];
  let unavailable: string | null = null;
  try {
    requests = await listVerificationRequests();
  } catch (error) {
    if (!(error instanceof VipUnavailableError)) throw error;
    unavailable = VIP_MIGRATION_ERROR;
  }

  // Embudo por casino: no debe tumbar la página si falla.
  let funnel: CasinoFunnelRow[] = [];
  try {
    funnel = await getCasinoFunnel();
  } catch (error) {
    console.error("Error loading casino funnel:", error);
  }

  // Depósito mínimo de cada casino: si falla, el panel enseña 30 €.
  let minDeposits: Record<string, number> = {};
  try {
    minDeposits = await getMinDepositByCasino();
  } catch (error) {
    console.error("Error loading casino minimum deposits:", error);
  }

  return (
    <div className="p-6">
      <SiteHeader title="Verificaciones" />
      <Suspense fallback={<div>Cargando solicitudes...</div>}>
        <PageBody requests={requests} unavailable={unavailable} funnel={funnel} minDeposits={minDeposits} />
      </Suspense>
    </div>
  );
}
