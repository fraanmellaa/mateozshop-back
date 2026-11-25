import { SiteHeader } from "../components/Header";
import { getAllLegalPages } from "../utils/legal";

import PageBody from "./PageBody";
import { requireAdminPage } from "@/app/utils/auth";

export const dynamic = "force-dynamic";

export default async function LegalPage() {
  await requireAdminPage();
  const pages = await getAllLegalPages();

  return (
    <div className="p-6">
      <SiteHeader title="Textos legales" />
      <PageBody pages={pages} />
    </div>
  );
}
