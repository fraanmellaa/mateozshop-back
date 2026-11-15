"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Edit, Plus, Power, Trash2 } from "lucide-react";
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
import { HIDDEN_COUNTRIES } from "../utils/bonuses/countries";
import BonusModal from "./BonusModal";

function countriesLabel(bonus: Bonus) {
  const base = bonus.countries.filter(
    (c) => !bonus.blocked_countries.includes(c)
  );
  return base.join(", ") || "Ninguno (no se muestra)";
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

  const filter = countryFilter.trim().toUpperCase();
  const visibleRows = filter
    ? bonuses.filter(
        (b) =>
          !HIDDEN_COUNTRIES.includes(filter) &&
          !b.blocked_countries.includes(filter) &&
          b.countries.includes(filter)
      )
    : bonuses;

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

  // Reasigna el orden 1..n según la nueva posición en la lista.
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= bonuses.length) return;
    const reordered = [...bonuses];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    return run(async () => {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].position !== i + 1) {
          await send(`/api/admin/bonuses/${reordered[i].id}`, "PUT", {
            position: i + 1,
          });
        }
      }
    }, "Error al reordenar");
  };

  const nextPosition =
    bonuses.reduce((max, bonus) => Math.max(max, bonus.position), 0) + 1;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <p className="text-sm text-muted-foreground">
          {bonuses.length} casinos. Solo los activos se muestran en la web, y
          solo en los países con licencia. Andorra (AD) queda siempre oculto.
        </p>
        <input
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          maxLength={2}
          placeholder="Filtrar país (ES)"
          className="h-9 w-40 rounded-md border bg-transparent px-3 text-sm"
        />
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
              <TableHead>Logo</TableHead>
              <TableHead>Casino</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Bono</TableHead>
              <TableHead>Países con licencia</TableHead>
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
                <TableRow key={bonus.id}>
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
                  <TableCell>{bonus.position}</TableCell>
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
                <TableCell colSpan={9} className="h-24 text-center">
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
