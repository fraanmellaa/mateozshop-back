import { Suspense } from "react";

import { SiteHeader } from "../components/Header";
import { VipUnavailableError } from "../utils/points/vip";
import { VIP_MIGRATION_ERROR } from "../utils/products/currency";
import { listVerificationRequests, type AdminVerificationRequest } from "../utils/verification";
import { getCasinoFunnel, type CasinoFunnelRow } from "../utils/verification/stats";
import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

// Solicitudes de verificación de afiliados: el admin comprueba el usuario del
// casino y aprueba (el usuario pasa a verificado y gana puntos VIP) o rechaza.
export default async function VerificationsPage() {
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

  return (
    <div className="p-6">
      <SiteHeader title="Verificaciones" />
      <Suspense fallback={<div>Cargando solicitudes...</div>}>
        <PageBody requests={requests} unavailable={unavailable} funnel={funnel} />
      </Suspense>
    </div>
  );
}
