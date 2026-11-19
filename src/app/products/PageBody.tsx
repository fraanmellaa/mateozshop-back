"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import type { ProductRow } from "@/app/utils/products";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, MoreHorizontal, Plus, Edit, Trash2 } from "lucide-react";
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
import CreateProductModal from "./CreateProductModal";
import EditProductModal from "./EditProductModal";
import { toDateTimeLocal } from "@/app/utils/datetime";

const DELIVERY_LABEL: Record<string, string> = {
  code: "Código",
  dm: "Mensaje privado",
  trade: "Steam",
};

const STATUS_LABEL: Record<string, string> = {
  waiting: "Esperando pujas",
  in_progress: "En puja",
  archived: "Sin stock",
  finalizing: "Adjudicándose",
  cancelling: "Retirándose",
};

export default function PageBody({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    null
  );

  const handleDeleteProduct = async (id: number) => {
    if (!confirm("¿Eliminar este premio? Si hay una puja en marcha, se devuelven los puntos al mejor postor."))
      return;

    try {
      const response = await fetch(`/api/admin/products/${id}`, {
        method: "DELETE",
      });
      if (response.ok) router.refresh();
      else {
        const err = await response.json();
        alert(err.error || "Error eliminando producto");
      }
    } catch (error) {
      console.error("Error deleting product:", error);
      alert("Error eliminando producto");
    }
  };

  const columns: ColumnDef<ProductRow>[] = [
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
            alt="Producto"
            width={40}
            height={40}
            className="rounded-md object-cover"
          />
        </div>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-2.5"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Nombre <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="text-left font-medium max-w-[200px] truncate">
          {row.getValue("name")}
        </div>
      ),
    },
    {
      accessorKey: "price",
      header: () => <div className="text-left">Precio de salida</div>,
      cell: ({ row }) => (
        <div className="text-left font-medium">{row.getValue("price")} pts</div>
      ),
    },
    {
      accessorKey: "stock",
      header: () => <div className="text-left">Stock</div>,
      cell: ({ row }) => (
        <div className="text-left font-medium">{row.getValue("stock")}</div>
      ),
    },
    {
      accessorKey: "value_eur",
      header: () => <div className="text-left">Valor</div>,
      cell: ({ row }) => {
        const value = row.original.value_eur;
        return <div className="text-left">{value === null ? "—" : `${value} €`}</div>;
      },
    },
    {
      accessorKey: "delivery_type",
      header: () => <div className="text-left">Entrega</div>,
      cell: ({ row }) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-gray-300 bg-gray-500/20">
          {DELIVERY_LABEL[row.original.delivery_type] ?? row.original.delivery_type}
        </span>
      ),
    },
    {
      accessorKey: "auction_status",
      header: () => <div className="text-left">Estado</div>,
      cell: ({ row }) => {
        const p = row.original;
        const status = STATUS_LABEL[p.auction_status] ?? p.auction_status;
        return (
          <div className="text-left text-sm">
            <div className="font-medium">{status}</div>
            {p.auction_status === "in_progress" && (
              <div className="text-muted-foreground">
                {p.current_bid} pts
                {p.current_bidder_username ? ` · ${p.current_bidder_username}` : ""}
                {p.auction_ends_at
                  ? ` · cierra ${toDateTimeLocal(p.auction_ends_at).replace("T", " ")}`
                  : ""}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-2.5"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Fecha <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="text-left">
          {new Date(
            (row.getValue("created_at") as number) * 1000
          ).toLocaleDateString("es-ES")}
        </div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const product = row.original;
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
                  navigator.clipboard.writeText(product.id.toString())
                }
              >
                Copiar ID
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/products/${product.id}`)}
              >
                Ver detalle y códigos
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setSelectedProduct(product);
                  setIsEditModalOpen(true);
                }}
                className="flex items-center"
              >
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteProduct(product.id)}
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
    data: products,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, value) => {
      const name = row.original.name?.toLowerCase() || "";
      const searchValue = value.toLowerCase();
      return name.includes(searchValue);
    },
    state: { sorting, columnFilters, globalFilter },
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Buscar por nombre..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Crear Premio
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
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
                  No se encontraron productos.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Mostrando {table.getRowModel().rows.length} de {products.length}{" "}
          productos
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

      <CreateProductModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          setIsCreateModalOpen(false);
          router.refresh();
        }}
      />

      <EditProductModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedProduct(null);
        }}
        onSuccess={() => {
          setIsEditModalOpen(false);
          setSelectedProduct(null);
          router.refresh();
        }}
        product={selectedProduct}
      />
    </div>
  );
}
