import { Suspense } from "react";
import { SiteHeader } from "../components/Header";
import PageBody from "./PageBody";
import { getAllBonuses } from "../utils/bonuses";
import { requireAdminPage } from "@/app/utils/auth";

export default async function BonusesPage() {
  await requireAdminPage();
  const bonuses = await getAllBonuses();

  return (
    <div className="p-6">
      <SiteHeader title="Gestión de Bonos" />
      <Suspense fallback={<div>Cargando bonos...</div>}>
        <PageBody bonuses={bonuses} />
      </Suspense>
    </div>
  );
}
