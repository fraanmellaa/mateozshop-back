"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Ilustración de una caja o de un premio: se sube desde el ordenador (se guarda
 * en WebP) o se pega su dirección. Enseña cómo queda y deja quitarla.
 */
export default function ImageField({
  value,
  onChange,
  onBusy,
  emptyHint,
}: {
  value: string;
  onChange: (url: string) => void;
  /** Avisa mientras sube, para no guardar el formulario a medias. */
  onBusy?: (busy: boolean) => void;
  /** Qué se ve en la web si no hay imagen. */
  emptyHint: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    onBusy?.(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/uploads/box-image", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.url) onChange(payload.url);
      else setError(payload?.message ?? "No se pudo subir la imagen");
    } catch {
      setError("No se pudo subir la imagen");
    } finally {
      setUploading(false);
      onBusy?.(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa de una URL cualquiera
            <img src={value} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="px-1 text-center text-[10px] leading-tight text-muted-foreground">Sin imagen</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Subiendo..." : value ? "Cambiar imagen" : "Subir imagen"}
          </Button>
          {value && (
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => onChange("")}>
              Quitar
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>
      </div>
      <Input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="O pega aquí la dirección de la imagen (https://...)"
      />
      <p className="text-xs text-muted-foreground">
        PNG, JPG o WebP de hasta 5 MB; mejor con fondo transparente. {emptyHint}
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
