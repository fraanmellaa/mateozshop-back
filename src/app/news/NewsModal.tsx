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
import type { News } from "../utils/news";
import { isSafeNewsLink, NEWS_LIMITS } from "../utils/news/schema";

interface Props {
  isOpen: boolean;
  news: News | null; // null = crear
  onClose: () => void;
  onSuccess: () => void;
}

export default function NewsModal(props: Props) {
  return <NewsModalInner key={`${props.isOpen}-${props.news?.id ?? "new"}`} {...props} />;
}

function NewsModalInner({ isOpen, news, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({
    title: news?.title ?? "",
    summary: news?.summary ?? "",
    body: news?.body ?? "",
    image: news?.image ?? "",
    tag: news?.tag ?? "",
    link_url: news?.link_url ?? "",
    link_text: news?.link_text ?? "",
    pinned: news?.pinned ?? false,
    is_published: news?.is_published ?? false,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Mismas reglas que el servidor (que es quien decide): aquí solo se avisa antes.
  const image = form.image.trim();
  const imageInvalid = image !== "" && !/^https:\/\/\S+$/i.test(image);
  const link = form.link_url.trim();
  const linkInvalid = link !== "" && !isSafeNewsLink(link);
  const invalid = imageInvalid || linkInvalid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setIsLoading(true);
    try {
      const response = await fetch(news ? `/api/admin/news/${news.id}` : "/api/admin/news", {
        method: news ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (response.ok) onSuccess();
      else {
        const error = await response.json().catch(() => null);
        alert(`Error: ${error?.error ?? "No se pudo guardar"}`);
      }
    } catch (error) {
      console.error("Error saving news:", error);
      alert("Error al guardar la novedad");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{news ? "Editar novedad" : "Nueva novedad"}</DialogTitle>
          <DialogDescription>
            El texto es plano: se muestra tal cual, con sus saltos de línea, sin
            formato ni enlaces activos. Para enlazar algo usa el botón.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={NEWS_LIMITS.title}
              required
            />
            {news && (
              <p className="text-xs text-muted-foreground">
                Dirección: /novedades/{news.slug} (no cambia aunque cambies el título)
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="summary">Resumen (para la tarjeta)</Label>
            <Textarea
              id="summary"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              maxLength={NEWS_LIMITS.summary}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Texto</Label>
            <Textarea
              id="body"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={NEWS_LIMITS.body}
              rows={10}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tag">Etiqueta</Label>
              <Input
                id="tag"
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                placeholder="Evento, Tienda, Aviso..."
                maxLength={NEWS_LIMITS.tag}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image">Imagen (URL https)</Label>
              <Input
                id="image"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="https://..."
                maxLength={NEWS_LIMITS.url}
              />
              {imageInvalid && (
                <p className="text-xs text-red-500">Debe empezar por https://</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="link_url">Enlace del botón</Label>
              <Input
                id="link_url"
                value={form.link_url}
                onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                placeholder="/puntos o https://..."
                maxLength={NEWS_LIMITS.url}
              />
              {linkInvalid && (
                <p className="text-xs text-red-500">
                  Una URL http(s) o una ruta interna que empiece por /
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="link_text">Texto del botón</Label>
              <Input
                id="link_text"
                value={form.link_text}
                onChange={(e) => setForm({ ...form, link_text: e.target.value })}
                placeholder="Ver más"
                maxLength={NEWS_LIMITS.linkText}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_published"
                checked={form.is_published}
                onCheckedChange={(checked) => setForm({ ...form, is_published: checked === true })}
              />
              <Label htmlFor="is_published">Publicada</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="pinned"
                checked={form.pinned}
                onCheckedChange={(checked) => setForm({ ...form, pinned: checked === true })}
              />
              <Label htmlFor="pinned">Fijada arriba</Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vista previa</Label>
            <div className="space-y-2 rounded-xl border p-4">
              {image && !imageInvalid && (
                // Vista previa de una URL que pega el admin: sin optimizador.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="aspect-video w-full rounded-lg object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              {form.tag.trim() && (
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {form.tag}
                </p>
              )}
              <p className="text-lg font-bold">{form.title || "Título"}</p>
              {form.summary && <p className="text-sm text-muted-foreground">{form.summary}</p>}
              <p className="whitespace-pre-wrap break-words text-sm">{form.body}</p>
              {link && !linkInvalid && (
                <p className="text-sm font-semibold">
                  [{form.link_text.trim() || "Ver más"}] → {link}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || invalid}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
