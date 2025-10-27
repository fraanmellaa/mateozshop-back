import { Suspense } from "react";
import { SiteHeader } from "../components/Header";
import PageBody from "./PageBody";
import { getGiveaways } from "../utils/giveaways/admin";

export default async function GiveawaysPage() {
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
