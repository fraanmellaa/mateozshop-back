"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Prediction } from "../utils/predictions";
import type { PredictionSettings } from "../utils/predictions/schema";
import PredictionModal from "./PredictionModal";

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

const fmt = (seconds: number | null) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("es-ES", {
        timeZone: "Europe/Andorra",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

export default function PageBody({
  predictions,
  settings,
}: {
  predictions: Prediction[];
  settings: PredictionSettings;
}) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selected, setSelected] = useState<Prediction | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, errorMessage: string) => {
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (error) {
      console.error(errorMessage, error);
      alert(`${errorMessage}: ${error instanceof Error ? error.message : "error"}`);
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = (p: Prediction) =>
    run(
      () => send(`/api/admin/predictions/${p.id}`, "PUT", { is_published: !p.is_published }),
      "Error al cambiar el estado"
    );

  const remove = (p: Prediction) => {
    if (!confirm(`¿Eliminar "${p.title}"? Esta acción no se puede deshacer.`)) return;
    return run(() => send(`/api/admin/predictions/${p.id}`, "DELETE"), "Error al eliminar");
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <p className="text-sm text-muted-foreground">
          {predictions.length} pronósticos. Solo los publicados se ven en la web.
        </p>
        <Button
          onClick={() => {
            setSelected(null);
            setIsModalOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo pronóstico
        </Button>
      </div>

      <div className="mb-4 rounded-md border p-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-publish"
            checked={settings.autoPublishTelegram}
            disabled={busy}
            onCheckedChange={(checked) =>
              run(
                () =>
                  send("/api/admin/predictions/settings", "PUT", {
                    autoPublishTelegram: checked === true,
                  }),
                "Error al guardar el ajuste"
              )
            }
          />
          <Label htmlFor="auto-publish">
            Publicar automáticamente lo que llegue de Telegram
          </Label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Desactivado: los mensajes del canal llegan como borrador y los publicas
          tú. Si editas el mensaje en Telegram, se actualiza aquí el texto y el
          título (la primera línea).
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Deporte</TableHead>
              <TableHead>Pick</TableHead>
              <TableHead>Cuota</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {predictions.length ? (
              predictions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-[260px] truncate font-medium">{p.title}</TableCell>
                  <TableCell>{p.sport ?? "-"}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{p.pick ?? "-"}</TableCell>
                  <TableCell>{p.odds ?? "-"}</TableCell>
                  <TableCell>{fmt(p.event_at)}</TableCell>
                  <TableCell>{p.source === "telegram" ? "Telegram" : "Panel"}</TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        p.is_published
                          ? "text-green-300 bg-green-500/20"
                          : "text-gray-300 bg-gray-500/20"
                      }`}
                    >
                      {p.is_published ? "Publicado" : "Borrador"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={p.is_published ? "Despublicar" : "Publicar"}
                        disabled={busy}
                        onClick={() => togglePublished(p)}
                      >
                        {p.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        disabled={busy}
                        onClick={() => {
                          setSelected(p);
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
                        onClick={() => remove(p)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  No hay pronósticos todavía.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PredictionModal
        isOpen={isModalOpen}
        prediction={selected}
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
