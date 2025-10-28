"use client";

import { useState } from "react";
import { DynamicTable } from "../components/DynamicTable";
import { ColumnDef } from "@tanstack/react-table";
import { User } from "../utils/users/types";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown,
  MoreHorizontal,
  Eye,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import AddPointsModal from "./AddPointsModal";
import RemovePointsModal from "./RemovePointsModal";
import ResetPointsModal from "./ResetPointsModal";

import { sendKickBotMessage } from "@/app/utils/chat";

export default function PageBody({ users }: { users: User[] }) {
  const router = useRouter();
  const [isAddPointsOpen, setIsAddPointsOpen] = useState(false);
  const [isRemovePointsOpen, setIsRemovePointsOpen] = useState(false);
  const [isResetPointsOpen, setIsResetPointsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const handleViewUser = (userId: number) => {
    router.push(`/users/${userId}`);
  };

  const handleAddPoints = async (points: number) => {
    if (!selectedUser) return;

    try {
      // Enviar comando para añadir puntos
      const message = `!points add @${selectedUser.username} ${points}`;
      await sendKickBotMessage(message);

      console.log(`Added ${points} points to user ${selectedUser.username}`);

      // Mostrar mensaje de éxito (opcional)
      // alert(`Puntos añadidos exitosamente a ${selectedUser.username}`);

      // Refresh la página después de la acción
      router.refresh();
    } catch (error) {
      console.error("Error adding points:", error);
      alert("Error al añadir puntos");
    }
  };

  const handleRemovePoints = async (points: number) => {
    if (!selectedUser) return;

    try {
      // Enviar comando para quitar puntos (cantidad negativa)
      const message = `!points add @${selectedUser.username} -${points}`;
      await sendKickBotMessage(message);

      console.log(
        `Removed ${points} points from user ${selectedUser.username}`
      );

      // Mostrar mensaje de éxito (opcional)
      // alert(`Puntos removidos exitosamente de ${selectedUser.username}`);

      // Refresh la página después de la acción
      router.refresh();
    } catch (error) {
      console.error("Error removing points:", error);
      alert("Error al quitar puntos");
    }
  };

  const handleResetPoints = async () => {
    if (!selectedUser) return;

    try {
      // Enviar comando para resetear puntos a 0
      const message = `!points set @${selectedUser.username} 0`;
      await sendKickBotMessage(message);

      console.log(`Reset points for user ${selectedUser.username}`);

      // Mostrar mensaje de éxito (opcional)
      // alert(`Puntos reseteados exitosamente para ${selectedUser.username}`);

      // Refresh la página después de la acción
      router.refresh();
    } catch (error) {
      console.error("Error resetting points:", error);
      alert("Error al resetear puntos");
    }
  };

  const openAddPointsModal = (user: User) => {
    setSelectedUser(user);
    setIsAddPointsOpen(true);
  };

  const openRemovePointsModal = (user: User) => {
    setSelectedUser(user);
    setIsRemovePointsOpen(true);
  };

  const openResetPointsModal = (user: User) => {
    setSelectedUser(user);
    setIsResetPointsOpen(true);
  };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "id",
      header: () => <div className="text-left pl-4">ID</div>,
      cell: ({ row }) => (
        <div className="capitalize text-left pl-4">{row.getValue("id")}</div>
      ),
    },
    {
      accessorKey: "email",
      header: () => <div className="text-left">Email</div>,
      cell: ({ row }) => (
        <div className="lowercase text-left">{row.getValue("email")}</div>
      ),
    },
    {
      accessorKey: "username",

      header: () => <div className="text-left">Username</div>,
      cell: ({ row }) => (
        <div className="lowercase text-left">{row.getValue("username")}</div>
      ),
    },
    {
      accessorKey: "puntos",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Puntos
            <ArrowUpDown />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="lowercase text-left">{row.original.actual_points}</div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      header: () => <div className="text-left">Acciones</div>,
      cell: ({ row }) => {
        const user = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(user.id.toString())
                }
              >
                Copiar ID
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(user.email.toString())
                }
              >
                Copiar EMAIL
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(user.username.toString())
                }
              >
                Copiar USUARIO
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleViewUser(user.id)}
                className="flex items-center"
              >
                <Eye className="mr-2 h-4 w-4" />
                Ver Usuario
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openAddPointsModal(user)}
                className="flex items-center text-green-300"
              >
                <Plus className="mr-2 h-4 w-4" />
                Dar Puntos
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openRemovePointsModal(user)}
                className="flex items-center text-yellow-300"
              >
                <Minus className="mr-2 h-4 w-4" />
                Quitar Puntos
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openResetPointsModal(user)}
                className="flex items-center text-red-300"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Resetear Puntos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DynamicTable
        columns={columns}
        data={users}
        filter={{
          text: "email",
          value: "email",
        }}
      />

      {/* Modales */}
      <AddPointsModal
        isOpen={isAddPointsOpen}
        onClose={() => {
          setIsAddPointsOpen(false);
          setSelectedUser(null);
        }}
        onConfirm={handleAddPoints}
        username={selectedUser?.username || ""}
      />

      <RemovePointsModal
        isOpen={isRemovePointsOpen}
        onClose={() => {
          setIsRemovePointsOpen(false);
          setSelectedUser(null);
        }}
        onConfirm={handleRemovePoints}
        username={selectedUser?.username || ""}
        currentPoints={selectedUser?.actual_points || 0}
      />

      <ResetPointsModal
        isOpen={isResetPointsOpen}
        onClose={() => {
          setIsResetPointsOpen(false);
          setSelectedUser(null);
        }}
        onConfirm={handleResetPoints}
        username={selectedUser?.username || ""}
        currentPoints={selectedUser?.actual_points || 0}
      />
    </>
  );
}
