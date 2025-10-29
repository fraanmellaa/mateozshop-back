import { getGiveawayById } from "@/app/utils/giveaways";
import { notFound } from "next/navigation";
import Image from "next/image";
import GiveawayDetailClient from "./GiveawayDetailClient";
import ParticipantsList from "./ParticipantsList";

export default async function GiveawayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const giveawayId = parseInt(id);

  if (isNaN(giveawayId)) {
    return notFound();
  }

  const giveaway = await getGiveawayById(giveawayId);

  if (!giveaway) {
    return notFound();
  }

  const now = Math.floor(Date.now() / 1000);
  let status = "active";
  if (now < giveaway.start_at) status = "upcoming";
  else if (now > giveaway.end_at) status = "finished";

  const statusColors = {
    upcoming: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    active: "bg-green-500/20 text-green-400 border border-green-500/30",
    finished: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
  };

  const statusText = {
    upcoming: "Próximamente",
    active: "Activo",
    finished: "Finalizado",
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Detalle del Sorteo</h1>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              statusColors[status as keyof typeof statusColors]
            }`}
          >
            {statusText[status as keyof typeof statusText]}
          </span>
        </div>
      </div>

      {/* Información del sorteo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Imagen y detalles principales */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-lg shadow-sm border p-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-shrink-0">
                <Image
                  src={giveaway.image}
                  alt={giveaway.title}
                  width={300}
                  height={300}
                  className="rounded-lg object-cover"
                />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-4">{giveaway.title}</h2>
                <div className="space-y-3">
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Costo:
                    </span>
                    <span className="ml-2">{giveaway.cost} puntos</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Inicio:
                    </span>
                    <span className="ml-2">
                      {new Date(giveaway.start_at * 1000).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Fin:
                    </span>
                    <span className="ml-2">
                      {new Date(giveaway.end_at * 1000).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Total participantes:
                    </span>
                    <span className="ml-2">{giveaway.entries.length}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Total tickets:
                    </span>
                    <span className="ml-2">
                      {giveaway.entries.reduce(
                        (sum, entry) => sum + entry.tickets,
                        0
                      )}
                    </span>
                  </div>
                </div>

                {/* Ganador */}
                {giveaway.winners.length > 0 && (
                  <div className="mt-6 p-4 bg-green-500/20 border border-green-500/30 rounded-lg">
                    <h3 className="font-medium text-green-400 mb-2">
                      🎉 Ganador
                    </h3>
                    <div className="flex items-center gap-3">
                      <Image
                        src={giveaway.winners[0].profileImage}
                        alt={giveaway.winners[0].name}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                      <span className="font-medium">
                        {giveaway.winners[0].name}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Lista de participantes */}
          <div className="mt-8">
            <ParticipantsList participants={giveaway.entries} />
          </div>
        </div>

        {/* Sidebar - Comentarios y acciones */}
        <div className="lg:col-span-1">
          <GiveawayDetailClient giveaway={giveaway} status={status} />
        </div>
      </div>
    </div>
  );
}
