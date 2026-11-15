import { SiteHeader } from "../components/Header";
import { getAllLegalPages } from "../utils/legal";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function LegalPage() {
  const pages = await getAllLegalPages();

  return (
    <div className="p-6">
      <SiteHeader title="Textos legales" />
      <PageBody pages={pages} />
    </div>
  );
}
