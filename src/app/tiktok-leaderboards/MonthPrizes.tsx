"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TikTokMonthPrizes } from "@/app/utils/tiktok/monthPrizes";

const ERRORS: Record<string, string> = {
  INVALID_MONTH: "El mes no es válido.",
  INVALID_PLACE: "El puesto no es válido.",
  INVALID_AMOUNT: "Ese puesto no tiene puntos puestos en los ajustes de economía.",
  USER_NOT_FOUND: "No hay ningún usuario con ese nombre o ese id.",
  USER_AMBIGUOUS: "Hay más de un usuario con ese nombre: usa su id.",
  USER_BANNED: "Ese usuario está baneado.",
  PLACE_TAKEN: "Ese puesto ya tiene ganador este mes.",
  ALREADY_WINNER: "Ese usuario ya tiene otro puesto este mes.",
  MIGRATION_PENDING: "Falta aplicar la migración 0037 en Supabase.",
};

const fmt = (n: number) => n.toLocaleString("es-ES");

/**
 * Premio del mes del ranking de TikTok: el administrador escribe a mano quién
 * queda 1.º, 2.º y 3.º y se le abonan los puntos (no se calcula por visitas).
 */
export default function MonthPrizes({ initial }: { initial: TikTokMonthPrizes }) {
  const [state, setState] = useState(initial);
  const [users, setUsers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "month" | null>(null);

  const loadMonth = async (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setBusy("month");
    try {
      const response = await fetch(`/api/admin/tiktok/month-prizes?month=${month}`);
      const result = await response.json().catch(() => null);
      if (response.ok && result?.data) {
        setState(result.data);
        setUsers({});
      } else toast.error("No se ha podido cargar ese mes");
    } catch {
      toast.error("Error de conexión");
    } finally {
      setBusy(null);
    }
  };

  const grant = async (place: number) => {
    const user = (users[place] ?? "").trim();
    if (!user) return;
    const points = state.prizes[place - 1];
    if (!window.confirm(`¿Dar ${fmt(points)} puntos a «${user}» por el puesto ${place} de ${state.month}? No se puede deshacer.`)) {
      return;
    }
    setBusy(place);
    try {
      const response = await fetch("/api/admin/tiktok/month-prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: state.month, place, user }),
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.data) {
        setState(result.data);
        setUsers((current) => ({ ...current, [place]: "" }));
        toast.success("Premio entregado");
      } else toast.error(ERRORS[result?.error] ?? "No se ha podido entregar el premio");
    } catch {
      toast.error("Error de conexión");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Premio del mes</h2>
          <p className="text-sm text-muted-foreground">
            Puntos para el top 3 del ranking de TikTok. Los ganadores se marcan a mano; los puntos se
            abonan al momento. Si los entregas el último día del mes, el reinicio del día 1 los pone a 0.
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Mes</span>
          <Input
            type="month"
            value={state.month}
            disabled={busy !== null}
            onChange={(e) => void loadMonth(e.target.value)}
          />
        </label>
      </div>

      {!state.available && (
        <p className="mt-3 text-sm text-destructive">{ERRORS.MIGRATION_PENDING}</p>
      )}

      <div className="mt-4 space-y-3">
        {[1, 2, 3].map((place) => {
          const winner = state.winners.find((w) => w.place === place);
          return (
            <div key={place} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
              <p className="w-44 text-sm font-medium">
                Puesto {place} · {fmt(state.prizes[place - 1])} puntos
              </p>
              {winner ? (
                <p className="text-sm">
                  Entregado a <span className="font-medium">{winner.username || `Usuario ${winner.user_id}`}</span>{" "}
                  (id {winner.user_id}) · {fmt(winner.points)} puntos ·{" "}
                  {new Date(winner.created_at * 1000).toLocaleDateString("es-ES", { timeZone: "Europe/Andorra" })}
                </p>
              ) : (
                <>
                  <Input
                    className="max-w-xs"
                    placeholder="Nombre de usuario, id o id de Discord"
                    value={users[place] ?? ""}
                    disabled={!state.available || busy !== null}
                    onChange={(e) => setUsers((current) => ({ ...current, [place]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    disabled={!state.available || busy !== null || !(users[place] ?? "").trim()}
                    onClick={() => void grant(place)}
                  >
                    {busy === place ? "Entregando..." : "Entregar"}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
