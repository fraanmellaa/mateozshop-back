"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Prediction } from "../utils/predictions";

interface Props {
  isOpen: boolean;
  prediction: Prediction | null; // null = crear
  onClose: () => void;
  onSuccess: () => void;
}

// Segundos Unix <-> valor de <input type="datetime-local"> (hora local del navegador).
function toLocalInput(seconds: number | null) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export default function PredictionModal(props: Props) {
  return (
    <PredictionModalInner
      key={`${props.isOpen}-${props.prediction?.id ?? "new"}`}
      {...props}
    />
  );
}

function PredictionModalInner({ isOpen, prediction, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({
    title: prediction?.title ?? "",
    body: prediction?.body ?? "",
    sport: prediction?.sport ?? "",
    league: prediction?.league ?? "",
    pick: prediction?.pick ?? "",
    odds: prediction?.odds != null ? String(prediction.odds) : "",
    event_at: toLocalInput(prediction?.event_at ?? null),
    is_published: prediction?.is_published ?? false,
  });
  const [isLoading, setIsLoading] = useState(false);

  const oddsNumber = form.odds.trim() === "" ? null : Number(form.odds.replace(",", "."));
  const oddsInvalid = oddsNumber !== null && (!Number.isFinite(oddsNumber) || oddsNumber < 1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (oddsInvalid) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        prediction ? `/api/admin/predictions/${prediction.id}` : "/api/admin/predictions",
        {
          method: prediction ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            body: form.body,
            sport: form.sport,
            league: form.league,
            pick: form.pick,
            odds: oddsNumber,
            event_at: fromLocalInput(form.event_at),
            is_published: form.is_published,
          }),
        }
      );
      if (response.ok) onSuccess();
      else {
        const error = await response.json().catch(() => null);
        alert(`Error: ${error?.error ?? "No se pudo guardar"}`);
      }
    } catch (error) {
      console.error("Error saving prediction:", error);
      alert("Error al guardar el pronóstico");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prediction ? "Editar pronóstico" : "Nuevo pronóstico"}</DialogTitle>
          <DialogDescription>
            El texto es plano: se muestra tal cual, sin formato ni enlaces activos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Análisis</Label>
            <Textarea
              id="body"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={4000}
              rows={8}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sport">Deporte</Label>
              <Input
                id="sport"
                value={form.sport}
                onChange={(e) => setForm({ ...form, sport: e.target.value })}
                placeholder="Fútbol"
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="league">Liga</Label>
              <Input
                id="league"
                value={form.league}
                onChange={(e) => setForm({ ...form, league: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pick">Pick</Label>
              <Input
                id="pick"
                value={form.pick}
                onChange={(e) => setForm({ ...form, pick: e.target.value })}
                placeholder="Más de 2,5 goles"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="odds">Cuota</Label>
              <Input
                id="odds"
                inputMode="decimal"
                value={form.odds}
                onChange={(e) => setForm({ ...form, odds: e.target.value })}
                placeholder="1.85"
              />
              {oddsInvalid && (
                <p className="text-xs text-red-500">La cuota debe ser un número de 1 o más</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="event_at">Fecha del evento</Label>
            <Input
              id="event_at"
              type="datetime-local"
              value={form.event_at}
              onChange={(e) => setForm({ ...form, event_at: e.target.value })}
              className="w-60"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="is_published"
              checked={form.is_published}
              onCheckedChange={(checked) => setForm({ ...form, is_published: checked === true })}
            />
            <Label htmlFor="is_published">Publicado</Label>
          </div>

          <div className="space-y-2">
            <Label>Vista previa</Label>
            <div className="space-y-1 rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">
                {[form.sport, form.league].filter(Boolean).join(" · ") || "Deporte · Liga"}
              </p>
              <p className="text-lg font-bold">{form.title || "Título"}</p>
              {form.pick && (
                <p className="text-sm font-semibold">
                  {form.pick}
                  {oddsNumber !== null && !oddsInvalid ? ` @ ${oddsNumber}` : ""}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm">{form.body}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || oddsInvalid}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
