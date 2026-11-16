"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, Eye, EyeOff, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { News } from "../utils/news";
import NewsModal from "./NewsModal";

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

export default function PageBody({ news }: { news: News[] }) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selected, setSelected] = useState<News | null>(null);
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

  const togglePublished = (n: News) =>
    run(
      () => send(`/api/admin/news/${n.id}`, "PUT", { is_published: !n.is_published }),
      "Error al cambiar el estado"
    );

  const togglePinned = (n: News) =>
    run(
      () => send(`/api/admin/news/${n.id}`, "PUT", { pinned: !n.pinned }),
      "Error al fijar la novedad"
    );

  const remove = (n: News) => {
    if (!confirm(`¿Eliminar "${n.title}"? Esta acción no se puede deshacer.`)) return;
    return run(() => send(`/api/admin/news/${n.id}`, "DELETE"), "Error al eliminar");
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <p className="text-sm text-muted-foreground">
          {news.length} novedades. Solo las publicadas se ven en la web; las
          fijadas salen las primeras.
        </p>
        <Button
          onClick={() => {
            setSelected(null);
            setIsModalOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nueva novedad
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Etiqueta</TableHead>
              <TableHead>Dirección</TableHead>
              <TableHead>Publicada</TableHead>
              <TableHead>Fijada</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {news.length ? (
              news.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="max-w-[280px] truncate font-medium">{n.title}</TableCell>
                  <TableCell>{n.tag ?? "-"}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    /novedades/{n.slug}
                  </TableCell>
                  <TableCell>{fmt(n.published_at)}</TableCell>
                  <TableCell>{n.pinned ? "Sí" : "-"}</TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        n.is_published
                          ? "text-green-300 bg-green-500/20"
                          : "text-gray-300 bg-gray-500/20"
                      }`}
                    >
                      {n.is_published ? "Publicada" : "Borrador"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={n.pinned ? "Dejar de fijar" : "Fijar arriba"}
                        disabled={busy}
                        onClick={() => togglePinned(n)}
                      >
                        {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={n.is_published ? "Despublicar" : "Publicar"}
                        disabled={busy}
                        onClick={() => togglePublished(n)}
                      >
                        {n.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        disabled={busy}
                        onClick={() => {
                          setSelected(n);
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
                        onClick={() => remove(n)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No hay novedades todavía.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <NewsModal
        isOpen={isModalOpen}
        news={selected}
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
