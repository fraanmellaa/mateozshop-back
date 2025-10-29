"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";

interface Participant {
  userId: number;
  name: string;
  profileImage: string;
  tickets: number;
  kickId?: string | null;
}

interface ParticipantsListProps {
  participants: Participant[];
}

export default function ParticipantsList({
  participants,
}: ParticipantsListProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const participantsPerPage = 10;

  // Ordenar participantes por cantidad de tickets
  const sortedParticipants = [...participants].sort((a, b) => {
    if (sortOrder === "desc") {
      return b.tickets - a.tickets;
    } else {
      return a.tickets - b.tickets;
    }
  });

  // Calcular paginación
  const totalPages = Math.ceil(sortedParticipants.length / participantsPerPage);
  const startIndex = (currentPage - 1) * participantsPerPage;
  const endIndex = startIndex + participantsPerPage;
  const currentParticipants = sortedParticipants.slice(startIndex, endIndex);

  const handleSort = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    setCurrentPage(1); // Reset to first page when sorting
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  return (
    <div className="bg-card rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold">
          Participantes ({participants.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSort}
          className="flex items-center gap-2"
        >
          <ArrowUpDown className="w-4 h-4" />
          Tickets {sortOrder === "desc" ? "↓" : "↑"}
        </Button>
      </div>

      {/* Lista de participantes */}
      <div className="space-y-2">
        {currentParticipants.map((participant, index) => (
          <div
            key={participant.userId}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-6">
                #{startIndex + index + 1}
              </span>
              <Image
                src={participant.profileImage}
                alt={participant.name}
                width={32}
                height={32}
                className="rounded-full"
              />
              <span className="font-medium">{participant.name}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium">
                {participant.tickets}{" "}
                {participant.tickets === 1 ? "ticket" : "tickets"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Mostrando {startIndex + 1} -{" "}
            {Math.min(endIndex, participants.length)} de {participants.length}{" "}
            participantes
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-1">
              {/* Mostrar páginas */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => goToPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
