import { SiteHeader } from "../components/Header";
import { listConnectionStatus } from "../utils/live/connections";

import PageBody from "./PageBody";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const connections = await listConnectionStatus();

  return (
    <div className="p-6">
      <SiteHeader title="Conexiones del streamer" />
      <PageBody connections={connections} returnedError={error} returnedConnected={connected} />
    </div>
  );
}
