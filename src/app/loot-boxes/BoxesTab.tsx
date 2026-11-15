"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Edit, Plus, Power, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  RARITIES,
  RARITY_LABELS,
  type AdminBox,
  type PrizeRow,
} from "@/app/utils/lootBoxes/types";

import BoxModal from "./BoxModal";
import PrizeModal from "./PrizeModal";
import { RARITY_STYLES, errorMessage } from "./shared";

function weightKey(r: (typeof RARITIES)[number]) {
  return `weight_${r}` as const;
}

export default function BoxesTab({ boxes }: { boxes: AdminBox[] }) {
  const router = useRouter();
  const [boxModal, setBoxModal] = useState<{ open: boolean; box: AdminBox | null }>({
    open: false,
    box: null,
  });
  const [prizeModal, setPrizeModal] = useState<{
    open: boolean;
    box: AdminBox | null;
    prize: PrizeRow | null;
  }>({ open: false, box: null, prize: null });

  const call = async (url: string, init: RequestInit, fallback: string, ok?: string) => {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        toast.error(await errorMessage(response, fallback));
        return;
      }
      if (ok) toast.success(ok);
      router.refresh();
    } catch (error) {
      console.error(fallback, error);
      toast.error("Error de conexión");
    }
  };

  const toggleBox = (box: AdminBox) =>
    call(
      `/api/admin/loot-boxes/${box.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !box.is_active }),
      },
      "Error actualizando la caja",
      box.is_active ? "Caja desactivada" : "Caja activada"
    );

  const deleteBox = (box: AdminBox) => {
    if (
      !confirm(
        `¿Eliminar la caja "${box.name}" y todos sus premios? El histórico de aperturas se conserva.`
      )
    )
      return;
    call(`/api/admin/loot-boxes/${box.id}`, { method: "DELETE" }, "Error eliminando la caja", "Caja eliminada");
  };

  const togglePrize = (prize: PrizeRow) =>
    call(
      `/api/admin/loot-boxes/prizes/${prize.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !prize.is_active }),
      },
      "Error actualizando el premio"
    );

  const deletePrize = (prize: PrizeRow) => {
    if (!confirm(`¿Eliminar el premio "${prize.name}"?`)) return;
    call(
      `/api/admin/loot-boxes/prizes/${prize.id}`,
      { method: "DELETE" },
      "Error eliminando el premio",
      "Premio eliminado"
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Las cajas nacen desactivadas. Para activar una necesita un premio Común de puntos y premios
          en cada categoría con probabilidad. Los premios agotados siguen en el sorteo y dan sus puntos de respaldo.
        </p>
        <Button onClick={() => setBoxModal({ open: true, box: null })}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva caja
        </Button>
      </div>

      {boxes.length === 0 && (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          Todavía no hay cajas.
        </div>
      )}

      {boxes.map((box) => (
        <section key={box.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{box.name}</h2>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    box.is_active ? "text-green-300 bg-green-500/20" : "text-gray-300 bg-gray-500/20"
                  }`}
                >
                  {box.is_active ? "Activa" : "Desactivada"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {box.price} pts · posición {box.position}
                {box.description ? ` · ${box.description}` : ""}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {RARITIES.map((r) => (
                  <span key={r}>
                    {RARITY_LABELS[r]}: {(box[weightKey(r)] / 100).toFixed(2)} %
                  </span>
                ))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleBox(box)}>
                <Power className="mr-2 h-4 w-4" />
                {box.is_active ? "Desactivar" : "Activar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBoxModal({ open: true, box })}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button variant="outline" size="sm" onClick={() => deleteBox(box)}>
                <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                Borrar
              </Button>
              <Button size="sm" onClick={() => setPrizeModal({ open: true, box, prize: null })}>
                <Plus className="mr-2 h-4 w-4" />
                Premio
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {RARITIES.map((rarity) => {
              const prizes = box.prizes.filter((p) => p.rarity === rarity);
              const styles = RARITY_STYLES[rarity];
              return (
                <div key={rarity} className={`rounded-md border-l-4 border p-3 ${styles.border}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                    <span className="text-sm font-medium">{RARITY_LABELS[rarity]}</span>
                    <span className="text-xs text-muted-foreground">
                      {(box[weightKey(rarity)] / 100).toFixed(2)} % de la caja
                    </span>
                  </div>
                  {prizes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin premios.</p>
                  ) : (
                    <ul className="space-y-1">
                      {prizes.map((p) => {
                        const total = prizes.reduce((s, x) => s + (x.is_active ? x.weight : 0), 0);
                        const share = p.is_active && total > 0 ? (p.weight / total) * 100 : 0;
                        const soldOut = p.stock !== null && p.stock <= 0;
                        return (
                          <li
                            key={p.id}
                            className={`flex flex-wrap items-center justify-between gap-2 text-sm ${
                              p.is_active ? "" : "opacity-50"
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{p.name}</span>{" "}
                              <span className="text-xs text-muted-foreground">
                                {p.kind === "points" ? `${p.points} pts` : "Objeto"} · peso {p.weight} (
                                {share.toFixed(1)} % de su categoría) ·{" "}
                                {p.stock === null ? "stock ilimitado" : `stock ${p.stock}`}
                                {p.stock !== null && p.fallback_points !== null
                                  ? ` · respaldo ${p.fallback_points} pts`
                                  : ""}
                                {p.is_active ? "" : " · inactivo"}
                              </span>
                              {soldOut && (
                                <span
                                  className="ml-2 inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300"
                                  title="Sigue en el sorteo: si sale, da sus puntos de respaldo"
                                >
                                  Agotado · da {p.fallback_points ?? "?"} pts
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => togglePrize(p)}>
                                {p.is_active ? "Desactivar" : "Activar"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPrizeModal({ open: true, box, prize: p })}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deletePrize(p)}>
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {boxModal.open && (
        <BoxModal
          box={boxModal.box}
          onClose={() => setBoxModal({ open: false, box: null })}
          onSaved={() => {
            setBoxModal({ open: false, box: null });
            router.refresh();
          }}
        />
      )}
      {prizeModal.open && prizeModal.box && (
        <PrizeModal
          box={prizeModal.box}
          prize={prizeModal.prize}
          onClose={() => setPrizeModal({ open: false, box: null, prize: null })}
          onSaved={() => {
            setPrizeModal({ open: false, box: null, prize: null });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
