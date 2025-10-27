"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DecoratedGiveaway } from "../utils/giveaways/admin";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown,
  MoreHorizontal,
  Plus,
  Edit,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import Image from "next/image";
import CreateGiveawayModal from "./CreateGiveawayModal";
import EditGiveawayModal from "./EditGiveawayModal";

export default function PageBody({
  giveaways,
}: {
  giveaways: DecoratedGiveaway[];
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedGiveaway, setSelectedGiveaway] =
    useState<DecoratedGiveaway | null>(null);

  const getStatusText = (status: string) => {
    switch (status) {
      case "upcoming":
        return { text: "Próximo", color: "text-blue-300 bg-blue-500/20" };
      case "active":
        return { text: "Activo", color: "text-green-300 bg-green-500/20" };
      case "finished":
        return { text: "Finalizado", color: "text-gray-300 bg-gray-500/20" };
      default:
        return { text: "Desconocido", color: "text-gray-300 bg-gray-500/20" };
    }
  };

  const handleFinishGiveaway = async (id: number) => {
    if (!confirm("¿Estás seguro de que quieres finalizar este sorteo?")) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/giveaways/${id}/finish`, {
        method: "POST",
      });

      if (response.ok) {
        router.refresh();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Error finishing giveaway:", error);
      alert("Error al finalizar el sorteo");
    }
  };

  const handleDeleteGiveaway = async (id: number) => {
    if (
      !confirm(
        "¿Estás seguro de que quieres eliminar este sorteo? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/giveaways/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        router.refresh();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Error deleting giveaway:", error);
      alert("Error al eliminar el sorteo");
    }
  };

  const columns: ColumnDef<DecoratedGiveaway>[] = [
    {
      accessorKey: "id",
      header: () => <div className="text-left pl-4">ID</div>,
      cell: ({ row }) => (
        <div className="text-left pl-4 font-medium">#{row.getValue("id")}</div>
      ),
    },
    {
      accessorKey: "image",
      header: () => <div className="text-left">Imagen</div>,
      cell: ({ row }) => (
        <div className="flex items-center">
          <Image
            src={row.getValue("image")}
            alt="Sorteo"
            width={40}
            height={40}
            className="rounded-md object-cover"
          />
        </div>
      ),
    },
    {
      accessorKey: "title",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Título
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="text-left font-medium max-w-[200px] truncate">
          {row.getValue("title")}
        </div>
      ),
    },
    {
      accessorKey: "cost",
      header: () => <div className="text-left">Costo</div>,
      cell: ({ row }) => (
        <div className="text-left font-medium">{row.getValue("cost")} pts</div>
      ),
    },
    {
      accessorKey: "status",
      header: () => <div className="text-left">Estado</div>,
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const statusInfo = getStatusText(status);

        return (
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
          >
            {statusInfo.text}
          </span>
        );
      },
      filterFn: (row, id, value) => {
        if (value === undefined || value === "") return true;
        return (row.getValue(id) as string) === value;
      },
    },
    {
      accessorKey: "sendable",
      header: () => <div className="text-left">Enviable</div>,
      cell: ({ row }) => {
        const sendable = row.getValue("sendable") as boolean;
        return (
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              sendable
                ? "text-green-300 bg-green-500/20"
                : "text-gray-300 bg-gray-500/20"
            }`}
          >
            {sendable ? "Sí" : "No"}
          </span>
        );
      },
    },
    {
      accessorKey: "participants_count",
      header: () => <div className="text-left">Participantes</div>,
      cell: ({ row }) => (
        <div className="text-left font-medium">
          {row.getValue("participants_count")}
        </div>
      ),
    },
    {
      accessorKey: "winner_username",
      header: () => <div className="text-left">Ganador</div>,
      cell: ({ row }) => {
        const username = row.getValue("winner_username") as string;
        return (
          <div className="text-left font-medium">
            {username || "Sin ganador"}
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Fecha
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="text-left">{row.getValue("created_at")}</div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const giveaway = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(giveaway.id.toString())
                }
              >
                Copiar ID del sorteo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setSelectedGiveaway(giveaway);
                  setIsEditModalOpen(true);
                }}
                className="flex items-center"
              >
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              {giveaway.status === "active" && (
                <DropdownMenuItem
                  onClick={() => handleFinishGiveaway(giveaway.id)}
                  className="flex items-center text-yellow-300"
                >
                  <X className="mr-2 h-4 w-4" />
                  Finalizar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteGiveaway(giveaway.id)}
                className="flex items-center text-red-300"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: giveaways,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, value) => {
      const title = row.original.title?.toLowerCase() || "";
      const searchValue = value.toLowerCase();

      return title.includes(searchValue);
    },
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Buscar por título..."
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-sm"
          />
          <select
            value={
              (table.getColumn("status")?.getFilterValue() as string) ?? ""
            }
            onChange={(e) =>
              table
                .getColumn("status")
                ?.setFilterValue(
                  e.target.value === "" ? undefined : e.target.value
                )
            }
            className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">Todos los estados</option>
            <option value="upcoming">Próximo</option>
            <option value="active">Activo</option>
            <option value="finished">Finalizado</option>
          </select>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Crear Sorteo
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No se encontraron sorteos.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Mostrando {table.getRowModel().rows.length} de {giveaways.length}{" "}
          sorteos
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Siguiente
          </Button>
        </div>
      </div>

      <CreateGiveawayModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setIsCreateModalOpen(false);
          router.refresh();
        }}
      />

      <EditGiveawayModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedGiveaway(null);
        }}
        onSuccess={() => {
          setIsEditModalOpen(false);
          setSelectedGiveaway(null);
          router.refresh();
        }}
        giveaway={selectedGiveaway}
      />
    </div>
  );
}
