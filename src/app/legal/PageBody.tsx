"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { LegalPage } from "../utils/legal";

function Editor({ page }: { page: LegalPage }) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/legal/${page.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (response.ok) {
        setMessage("Guardado");
        router.refresh();
      } else {
        const error = await response.json().catch(() => null);
        setMessage(`Error: ${error?.error ?? "No se pudo guardar"}`);
      }
    } catch {
      setMessage("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">/{page.slug}</h2>
        <span className="text-xs text-muted-foreground">
          {body.trim()
            ? "Publicado en la web"
            : "Sin texto: la web mostrará la página como pendiente"}
        </span>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`title-${page.slug}`}>Título</Label>
        <Input
          id={`title-${page.slug}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`body-${page.slug}`}>Texto</Label>
        <Textarea
          id={`body-${page.slug}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          maxLength={200000}
          className="font-mono text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !title.trim()}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}

export default function PageBody({ pages }: { pages: LegalPage[] }) {
  return (
    <div className="w-full space-y-6 py-4">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        El texto lo escribes tú: la web lo muestra tal cual, como texto plano
        (los saltos de línea se respetan; no hay formato ni enlaces activos). Es
        tu responsabilidad que sea correcto y esté actualizado.
      </p>
      {pages.length ? (
        pages.map((page) => <Editor key={page.slug} page={page} />)
      ) : (
        <p className="text-sm text-muted-foreground">
          No hay páginas. Aplica la migración 0025_content.sql.
        </p>
      )}
    </div>
  );
}
