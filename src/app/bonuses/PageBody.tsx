"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Edit, GripVertical, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Bonus } from "../utils/bonuses";
import { COUNTRY_GROUPS, countriesText } from "../utils/bonuses/countries";
import BonusModal from "./BonusModal";

function countriesLabel(bonus: Bonus) {
  const base = bonus.countries.filter(
    (c) => !bonus.blocked_countries.includes(c)
  );
  return countriesText(base) || "Ninguno (no se muestra)";
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? "Error desconocido");
  }
}

export default function PageBody({ bonuses }: { bonuses: Bonus[] }) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selected, setSelected] = useState<Bonus | null>(null);
  const [busy, setBusy] = useState(false);
  const [countryFilter, setCountryFilter] = useState("");
  // Orden mientras se arrastra una fila (null = el que viene de la BD).
  const [dragOrder, setDragOrder] = useState<Bonus[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  // El filtro es una zona del panel (España, Andorra...): salen los casinos
  // que se ven en alguno de sus países.
  const filterCodes = COUNTRY_GROUPS.find((group) => group.label === countryFilter)?.codes ?? [];
  const list = dragOrder ?? bonuses;
  const visibleRows = filterCodes.length
    ? list.filter((b) =>
        filterCodes.some((code) => b.countries.includes(code) && !b.blocked_countries.includes(code))
      )
    : list;

  const run = async (action: () => Promise<void>, errorMessage: string) => {
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (error) {
      console.error(errorMessage, error);
      alert(
        `${errorMessage}: ${error instanceof Error ? error.message : "error"}`
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (bonus: Bonus) =>
    run(
      () =>
        send(`/api/admin/bonuses/${bonus.id}`, "PUT", {
          is_active: !bonus.is_active,
        }),
      "Error al cambiar el estado"
    );

  const remove = (bonus: Bonus) => {
    if (
      !confirm(
        `¿Eliminar el bono de ${bonus.casino_name}? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    return run(
      () => send(`/api/admin/bonuses/${bonus.id}`, "DELETE"),
      "Error al eliminar el bono"
    );
  };

  // Guarda el orden 1..n de la lista entera de una vez.
  const saveOrder = (reordered: Bonus[]) =>
    run(async () => {
      await send("/api/admin/bonuses/order", "PUT", { ids: reordered.map((b) => b.id) });
    }, "Error al reordenar");

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= bonuses.length) return;
    const reordered = [...bonuses];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    return saveOrder(reordered);
  };

  // Arrastrar y soltar: la fila se mueve en vivo y el orden se guarda al soltar.
  const dragOver = (overId: number) => {
    if (dragId === null || dragId === overId) return;
    const current = dragOrder ?? bonuses;
    const from = current.findIndex((b) => b.id === dragId);
    const to = current.findIndex((b) => b.id === overId);
    if (from < 0 || to < 0) return;
    const reordered = [...current];
    const [item] = reordered.splice(from, 1);
    reordered.splice(to, 0, item);
    setDragOrder(reordered);
  };
  const dragEnd = async () => {
    const reordered = dragOrder;
    setDragId(null);
    if (reordered && reordered.some((b, i) => b.id !== bonuses[i]?.id)) {
      await saveOrder(reordered);
    }
    setDragOrder(null);
  };

  const nextPosition =
    bonuses.reduce((max, bonus) => Math.max(max, bonus.position), 0) + 1;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          {bonuses.length} casinos. Arrastra las filas para cambiar el orden de la web
          (los 3 primeros, o los destacados, van arriba). Cada casino sale solo en sus países.
        </p>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="h-9 w-44 rounded-md border bg-transparent px-3 text-sm"
          aria-label="Ver casinos de una zona"
        >
          <option value="">Todas las zonas</option>
          {COUNTRY_GROUPS.map((group) => (
            <option key={group.label} value={group.label}>
              {group.label}
            </option>
          ))}
        </select>
        <Button
          onClick={() => {
            setSelected(null);
            setIsModalOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo bono
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Logo</TableHead>
              <TableHead>Casino</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Bono</TableHead>
              <TableHead>Se muestra en</TableHead>
              <TableHead>Activo</TableHead>
              <TableHead>Orden</TableHead>
              <TableHead>Enlace</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length ? (
              visibleRows.map((bonus) => {
                const index = bonuses.indexOf(bonus);
                return (
                <TableRow
                  key={bonus.id}
                  draggable={!busy && !filterCodes.length}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(bonus.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    dragOver(bonus.id);
                  }}
                  onDrop={(e) => e.preventDefault()}
                  onDragEnd={dragEnd}
                  className={dragId === bonus.id ? "opacity-40" : undefined}
                >
                  <TableCell className="w-8 pr-0">
                    <GripVertical
                      className={`h-4 w-4 text-muted-foreground ${filterCodes.length ? "opacity-30" : "cursor-grab"}`}
                      aria-label="Arrastrar para ordenar"
                    />
                  </TableCell>
                  <TableCell>
                    {bonus.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bonus.image}
                        alt={`Logo de ${bonus.casino_name}`}
                        className="h-10 w-10 rounded object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {bonus.casino_name}
                    {bonus.featured && (
                      <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                        Destacado
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {bonus.color ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span
                          className="h-5 w-5 rounded border"
                          style={{ backgroundColor: bonus.color }}
                        />
                        {bonus.color}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate">
                    {bonus.offer}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {countriesLabel(bonus)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        bonus.is_active
                          ? "text-green-300 bg-green-500/20"
                          : "text-gray-300 bg-gray-500/20"
                      }`}
                    >
                      {bonus.is_active ? "Activo" : "Oculto"}
                    </span>
                  </TableCell>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    {bonus.url ? (
                      <a
                        href={bonus.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Ver enlace
                      </a>
                    ) : (
                      <span className="text-amber-400 text-sm">
                        Sin enlace (sin botón)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Subir"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Bajar"
                        disabled={busy || index === bonuses.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={bonus.is_active ? "Desactivar" : "Activar"}
                        disabled={busy}
                        onClick={() => toggleActive(bonus)}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        disabled={busy}
                        onClick={() => {
                          setSelected(bonus);
                          setIsModalOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Eliminar"
                        disabled={busy}
                        onClick={() => remove(bonus)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center">
                  No hay bonos todavía.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <BonusModal
        isOpen={isModalOpen}
        bonus={selected}
        nextPosition={nextPosition}
        onClose={() => {
          setIsModalOpen(false);
          setSelected(null);
        }}
        onSuccess={() => {
          setIsModalOpen(false);
          setSelected(null);
          router.refresh();
        }}
      />
    </div>
  );
}
