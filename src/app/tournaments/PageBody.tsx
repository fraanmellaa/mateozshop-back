"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminTournament } from "../utils/games/tournament";
import { fromDateTimeLocal } from "../utils/datetime";

type RankingRow = {
  position: number;
  username: string;
  chips: number;
  spinsUsed: number;
  finishedAt: number | null;
};

type Detail = {
  prizes: AdminTournament["prizes"];
  ranking: RankingRow[];
};

const STATUS: Record<string, { text: string; color: string }> = {
  upcoming: { text: "Próximo", color: "text-blue-300 bg-blue-500/20" },
  active: { text: "Activo", color: "text-green-300 bg-green-500/20" },
  closed: { text: "Cerrado", color: "text-gray-300 bg-gray-500/20" },
};

const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });

const PLACES = [1, 2, 3];

export default function PageBody({ tournaments }: { tournaments: AdminTournament[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rewards, setRewards] = useState<string[]>(["", "", ""]);
  const [isCreating, setIsCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) {
      toast.error("Indica las fechas de inicio y fin");
      return;
    }

    const prizes = PLACES.map((place, i) => ({ place, reward: rewards[i].trim() })).filter(
      (p) => p.reward !== ""
    );

    setIsCreating(true);
    try {
      const response = await fetch("/api/admin/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // datetime-local es hora local del navegador: fromDateTimeLocal la pasa bien a segundos Unix.
        body: JSON.stringify({
          title,
          startAt: fromDateTimeLocal(start),
          endAt: fromDateTimeLocal(end),
          prizes,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(result?.message || "No se ha podido crear el torneo");
        return;
      }
      toast.success("Torneo creado");
      setTitle("");
      setStart("");
      setEnd("");
      setRewards(["", "", ""]);
      router.refresh();
    } catch (error) {
      console.error("Error creating tournament:", error);
      toast.error("Error de conexión");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = async (id: number) => {
    if (!confirm("¿Cerrar el torneo ahora? Se fijan los ganadores y nadie podrá tirar más.")) return;
    const response = await fetch(`/api/admin/tournaments/${id}/close`, { method: "POST" });
    if (!response.ok) {
      toast.error("No se ha podido cerrar el torneo");
      return;
    }
    toast.success("Torneo cerrado");
    setOpenId(null);
    router.refresh();
  };

  const toggleDetail = async (id: number) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    const response = await fetch(`/api/admin/tournaments/${id}`);
    const result = await response.json().catch(() => null);
    if (response.ok && result?.data) setDetail(result.data as Detail);
    else toast.error("No se ha podido cargar el ranking");
  };

  return (
    <div className="mt-6 max-w-4xl space-y-6">
      <form onSubmit={handleCreate} className="space-y-4 rounded-md border p-4">
        <div>
          <h2 className="text-base font-semibold">Crear torneo</h2>
          <p className="text-sm text-muted-foreground">
            Las fechas son en tu hora local. Usa el nivel de Plinko, las tiradas y las fichas de Ajustes en
            este momento: quedan fijados en el torneo. Los premios son texto libre (solo el 1.º es obligatorio).
          </p>
        </div>
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="t-title" className="text-right">Título</Label>
          <Input id="t-title" className="col-span-3" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
        </div>
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="t-start" className="text-right">Inicio</Label>
          <Input id="t-start" type="datetime-local" className="col-span-3" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="t-end" className="text-right">Fin</Label>
          <Input id="t-end" type="datetime-local" className="col-span-3" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        {PLACES.map((place, i) => (
          <div key={place} className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`t-prize-${place}`} className="text-right">Premio {place}.º</Label>
            <Input
              id={`t-prize-${place}`}
              className="col-span-3"
              value={rewards[i]}
              maxLength={200}
              required={place === 1}
              onChange={(e) => setRewards(rewards.map((r, j) => (j === i ? e.target.value : r)))}
            />
          </div>
        ))}
        <div className="flex justify-end">
          <Button type="submit" disabled={isCreating}>{isCreating ? "Creando..." : "Crear torneo"}</Button>
        </div>
      </form>

      <div className="space-y-3">
        {tournaments.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay torneos.</p>}
        {tournaments.map((t) => {
          const status = STATUS[t.status];
          return (
            <section key={t.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">{t.title}</h3>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}>
                  {status.text}
                  {t.status === "closed" && !t.closed ? " (pendiente de cerrar)" : ""}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(t.startAt)} → {formatDate(t.endAt)} · {t.entries} participantes · Plinko {t.level},{" "}
                  {t.spinsPerEntry} tiradas de {t.chipsPerSpin} fichas
                </span>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggleDetail(t.id)}>
                    {openId === t.id ? "Ocultar" : "Ranking y ganadores"}
                  </Button>
                  {!t.closed && (
                    <Button variant="destructive" size="sm" onClick={() => handleClose(t.id)}>
                      Cerrar ahora
                    </Button>
                  )}
                </div>
              </div>

              <ul className="mt-2 text-sm">
                {t.prizes.map((p) => (
                  <li key={p.position}>
                    {p.position}.º {p.reward}
                    {p.winner && (
                      <span className="text-muted-foreground"> — ganador: {p.winner.username} ({p.winner.chips} fichas)</span>
                    )}
                  </li>
                ))}
              </ul>

              {openId === t.id && (
                <div className="mt-3 border-t pt-3 text-sm">
                  {!detail ? (
                    <p className="text-muted-foreground">Cargando ranking...</p>
                  ) : detail.ranking.length === 0 ? (
                    <p className="text-muted-foreground">Nadie ha tirado todavía.</p>
                  ) : (
                    <table className="w-full max-w-xl text-left">
                      <thead className="text-muted-foreground">
                        <tr><th>#</th><th>Usuario</th><th>Fichas</th><th>Tiradas</th><th>Terminó</th></tr>
                      </thead>
                      <tbody>
                        {detail.ranking.map((r) => (
                          <tr key={r.position}>
                            <td>{r.position}</td>
                            <td>{r.username}</td>
                            <td>{r.chips}</td>
                            <td>{r.spinsUsed}</td>
                            <td>{r.finishedAt ? formatDate(r.finishedAt) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
