"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DecoratedOrder } from "../utils/orders/types";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Eye, MoreHorizontal, TriangleAlert } from "lucide-react";
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
import { toast } from "sonner";
import ReviewOrderModal from "./ReviewOrderModal";
import { resendOrderCode, updateOrderStatus } from "../utils/orders/actions";

type View = "all" | "review" | "deliveries";

const DELIVERY_LABEL: Record<string, string> = {
  code: "Código por email",
  dm: "Mensaje privado",
  trade: "Intercambio de Steam",
};

const isPendingReview = (o: DecoratedOrder) => o.needs_review && !o.reviewed && o.status !== 2;
const isPendingDelivery = (o: DecoratedOrder) =>
  o.status === 0 && !(o.needs_review && !o.reviewed);

export default function PageBody({ allOrders }: { allOrders: DecoratedOrder[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [review, setReview] = useState<{ id: number; approve: boolean; vip: boolean; next?: boolean } | null>(null);

  const orders = useMemo(
    () =>
      allOrders.filter((o) =>
        view === "review" ? isPendingReview(o) : view === "deliveries" ? isPendingDelivery(o) : true
      ),
    [allOrders, view]
  );
  const reviewCount = allOrders.filter(isPendingReview).length;
  const deliveryCount = allOrders.filter(isPendingDelivery).length;

  const markDelivered = async (id: number) => {
    const result = await updateOrderStatus(id, 1);
    if (result.success) {
      toast.success("Pedido marcado como entregado");
      router.refresh();
    } else toast.error(result.error || "Error al actualizar el pedido");
  };

  const resendCode = async (id: number) => {
    const result = await resendOrderCode(id);
    if (result.success) {
      toast.success("Código reenviado");
      router.refresh();
    } else toast.error(result.error || "Error al reenviar el código");
  };
  const searchParams = useSearchParams();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Aplicar filtro inicial desde URL
  useEffect(() => {
    const userParam = searchParams.get("user");
    if (userParam) {
      setGlobalFilter(userParam);
    }
  }, [searchParams]);

  const getStatusText = (status: number) => {
    switch (status) {
      case 0:
        return { text: "Pendiente", color: "text-yellow-300 bg-yellow-500/20" };
      case 1:
        return { text: "Completada", color: "text-green-300 bg-green-500/20" };
      case 2:
        return { text: "Cancelada", color: "text-red-300 bg-red-500/20" };
      default:
        return { text: "Desconocido", color: "text-gray-300 bg-gray-500/20" };
    }
  };

  const columns: ColumnDef<DecoratedOrder>[] = [
    {
      accessorKey: "id",
      header: () => <div className="text-left pl-4">ID</div>,
      cell: ({ row }) => (
        <div className="text-left pl-4 font-medium">#{row.getValue("id")}</div>
      ),
    },
    {
      accessorKey: "username",
      header: () => <div className="text-left">Usuario</div>,
      cell: ({ row }) => (
        <div className="text-left font-medium">{row.getValue("username")}</div>
      ),
    },
    {
      accessorKey: "product_name",
      header: () => <div className="text-left">Producto</div>,
      cell: ({ row }) => {
        const productName = row.getValue("product_name") as string;
        const productImage = row.original.product_image;

        return (
          <div className="flex items-center space-x-3">
            <Image
              src={productImage}
              alt={productName}
              width={40}
              height={40}
              className="rounded-md object-cover"
            />
            <span className="text-left">{productName}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "total",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Total
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="text-left font-medium">{row.getValue("total")} pts</div>
      ),
    },
    {
      id: "delivery",
      header: () => <div className="text-left">Entrega</div>,
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="text-left text-sm">
            <div>{DELIVERY_LABEL[o.delivery_type] ?? o.delivery_type}</div>
            {o.delivery_type === "trade" &&
              (o.steam_trade_url ? (
                <a
                  href={o.steam_trade_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline"
                >
                  Enlace de Steam
                </a>
              ) : (
                <span className="text-red-300">Sin enlace de Steam</span>
              ))}
            {o.needs_review && (
              <div className={o.reviewed ? "text-green-300" : "text-yellow-300"}>
                {o.vip
                  ? o.reviewed
                    ? "Comprobado"
                    : "Pendiente de comprobar"
                  : o.reviewed
                    ? "Revisado"
                    : "Pendiente de revisión"}
              </div>
            )}
            {o.duplicate_flags.length > 0 && (
              <div
                className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-300"
                title={o.duplicate_flags
                  .map((flag) => `${flag.text}: ${flag.users.map((user) => user.username).join(", ")}`)
                  .join("\n")}
              >
                <TriangleAlert className="h-3 w-3" />
                Posible cuenta repetida
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: () => <div className="text-left">Estado</div>,
      cell: ({ row }) => {
        const status = row.getValue("status") as number;
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
        return (row.getValue(id) as number).toString() === value;
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
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return (
          <div className="text-left">
            {date.toLocaleDateString("es-ES", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        );
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const order = row.original;

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
                  navigator.clipboard.writeText(order.id.toString())
                }
              >
                Copiar ID del pedido
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isPendingReview(order) && (
                <>
                  <DropdownMenuItem onClick={() => setReview({ id: order.id, approve: true, vip: order.vip })}>
                    {order.vip ? "Confirmar" : "Aprobar"}
                  </DropdownMenuItem>
                  {order.vip && (
                    <DropdownMenuItem
                      onClick={() => setReview({ id: order.id, approve: false, vip: true, next: true })}
                    >
                      Volver a poner en puja
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => setReview({ id: order.id, approve: false, vip: order.vip })}
                    className="text-red-300"
                  >
                    Rechazar y devolver puntos
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {isPendingDelivery(order) && (
                <DropdownMenuItem onClick={() => markDelivered(order.id)}>
                  Marcar como entregado
                </DropdownMenuItem>
              )}
              {order.has_code && order.status !== 2 && !isPendingReview(order) && (
                <DropdownMenuItem onClick={() => resendCode(order.id)}>
                  Reenviar código por email
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => router.push(`/orders/${order.id}`)}
                className="flex items-center"
              >
                <Eye className="mr-2 h-4 w-4" />
                Ver detalles
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: orders,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, value) => {
      const username = row.original.username?.toLowerCase() || "";
      const productName = row.original.product_name?.toLowerCase() || "";
      const searchValue = value.toLowerCase();

      return (
        username.includes(searchValue) || productName.includes(searchValue)
      );
    },
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
  });

  return (
    <div className="w-full">
      <div className="flex gap-2 pt-4">
        {(
          [
            ["all", "Todos", allOrders.length],
            ["review", "Pendientes de revisar o comprobar", reviewCount],
            ["deliveries", "Entregas pendientes", deliveryCount],
          ] as [View, string, number][]
        ).map(([key, label, count]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={view === key ? "default" : "outline"}
            onClick={() => setView(key)}
          >
            {label} ({count})
          </Button>
        ))}
      </div>
      <div className="flex items-center py-4 gap-4">
        <Input
          placeholder="Buscar por usuario o producto..."
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className="max-w-sm"
        />
        <select
          value={(table.getColumn("status")?.getFilterValue() as string) ?? ""}
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
          <option value="0">Pendiente</option>
          <option value="1">Completada</option>
          <option value="2">Cancelada</option>
        </select>
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
                  No se encontraron resultados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Mostrando {table.getRowModel().rows.length} de {orders.length} pedidos
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
      <ReviewOrderModal
        orderId={review?.id ?? null}
        approve={review?.approve ?? true}
        vip={review?.vip ?? false}
        passNext={review?.next ?? false}
        isOpen={review !== null}
        onClose={() => setReview(null)}
        onDone={() => {
          setReview(null);
          router.refresh();
        }}
      />
    </div>
  );
}
