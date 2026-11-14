import { SiteHeader } from "../components/Header";
import { getAdminLootBoxes } from "../utils/lootBoxes";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function LootBoxesPage() {
  const boxes = await getAdminLootBoxes();

  return (
    <div className="p-6">
      <SiteHeader title="Cajas" />
      <PageBody boxes={boxes} />
    </div>
  );
}
