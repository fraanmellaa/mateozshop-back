import { Suspense } from "react";
import { SiteHeader } from "../components/Header";
import PageBody from "./PageBody";
import { getGiveaways } from "../utils/giveaways/admin";
import { requireAdminPage } from "@/app/utils/auth";

export default async function GiveawaysPage() {
  await requireAdminPage();
  const giveaways = await getGiveaways();

  return (
    <div className="p-6">
      <SiteHeader title="Gestión de Sorteos" />
      <Suspense fallback={<div>Cargando sorteos...</div>}>
        <PageBody giveaways={giveaways} />
      </Suspense>
    </div>
  );
}
