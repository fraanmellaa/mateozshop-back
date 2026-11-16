import { SiteHeader } from "../components/Header";
import { getAllNews } from "../utils/news";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const news = await getAllNews();

  return (
    <div className="p-6">
      <SiteHeader title="Novedades" />
      <PageBody news={news} />
    </div>
  );
}
