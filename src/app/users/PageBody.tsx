"use client";

import { DynamicTable } from "../components/DynamicTable";
import { ColumnDef } from "@tanstack/react-table";
import { User } from "../utils/users/types";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function PageBody({ users }: { users: User[] }) {
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
              <DropdownMenuItem>Ver Usuario</DropdownMenuItem>
              <DropdownMenuItem>Dar Puntos</DropdownMenuItem>
              <DropdownMenuItem>Quitar Puntos</DropdownMenuItem>
              <DropdownMenuItem>Resetear Puntos</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
  return (
    <DynamicTable
      columns={columns}
      data={users}
      filter={{
        text: "email",
        value: "email",
      }}
    />
  );
}
