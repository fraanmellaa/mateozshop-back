import { SiteHeader } from "../components/Header";
import { listTournaments } from "../utils/games/tournament";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const tournaments = await listTournaments();

  return (
    <div className="p-6">
      <SiteHeader title="Torneos semanales" />
      <PageBody tournaments={tournaments} />
    </div>
  );
}
