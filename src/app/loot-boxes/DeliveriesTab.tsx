"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RARITY_LABELS, type AdminOpening } from "@/app/utils/lootBoxes/types";

import { RARITY_STYLES, errorMessage, selectClass } from "./shared";

type Filter = "pending" | "delivered" | "all";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  delivered: "Entregado",
  completed: "Puntos abonados",
};

export default function DeliveriesTab() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminOpening[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Solo objetos: las aperturas de puntos no se entregan a mano.
      const params = new URLSearchParams({ page: String(page), kind: "item" });
      if (filter !== "all") params.set("status", filter);
      const response = await fetch(`/api/admin/loot-boxes/openings?${params}`);
      if (!response.ok) {
        setError(await errorMessage(response, "Error cargando las entregas"));
        return;
      }
      const body = await response.json();
      setRows(body.result as AdminOpening[]);
      setHasMore(Boolean(body.has_more));
    } catch (err) {
      console.error("Error loading openings:", err);
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    // Patrón habitual (copiar al estado lo que llega de fuera o de una carga): no provoca renders en cadena aquí.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const markDelivered = async (row: AdminOpening) => {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/admin/loot-boxes/openings/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered", delivery_note: notes[row.id] ?? "" }),
      });
      if (!response.ok) {
        toast.error(await errorMessage(response, "Error marcando como entregado"));
        return;
      }
      toast.success("Marcado como entregado");
      await load();
    } catch (err) {
      console.error("Error marking delivered:", err);
      toast.error("Error de conexión");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className={`${selectClass} max-w-[220px]`}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(1);
          }}
        >
          <option value="pending">Pendientes de entrega</option>
          <option value="delivered">Entregadas</option>
          <option value="all">Todas (objetos)</option>
        </select>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Jugador</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Kick</TableHead>
              <TableHead>Premio</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="min-w-[260px]">Entrega</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {loading ? "Cargando..." : "No hay entregas."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(r.created_at * 1000).toLocaleString("es-ES")}
                  </TableCell>
                  <TableCell>{r.user?.username ?? `#${r.user_id}`}</TableCell>
                  <TableCell>{r.user?.email ?? "—"}</TableCell>
                  <TableCell>{r.user?.kick_username ?? "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.prize_name}</div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${RARITY_STYLES[r.rarity].badge}`}
                    >
                      {RARITY_LABELS[r.rarity]}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground">{r.box_name}</span>
                  </TableCell>
                  <TableCell>{STATUS_LABELS[r.status] ?? r.status}</TableCell>
                  <TableCell>
                    {r.status === "pending" ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Nota (opcional)"
                          maxLength={500}
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                        />
                        <Button size="sm" disabled={busyId === r.id} onClick={() => markDelivered(r)}>
                          {busyId === r.id ? "..." : "Marcar entregado"}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.delivered_at ? new Date(r.delivered_at * 1000).toLocaleString("es-ES") : ""}
                        {r.delivery_note ? ` · ${r.delivery_note}` : ""}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
          Anterior
        </Button>
        <span className="text-sm text-muted-foreground">Página {page}</span>
        <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => setPage(page + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}
