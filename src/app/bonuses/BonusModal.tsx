"use client";

import { useRef, useState } from "react";
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
import type { Bonus } from "../utils/bonuses";

interface BonusModalProps {
  isOpen: boolean;
  bonus: Bonus | null; // null = crear
  nextPosition: number;
  onClose: () => void;
  onSuccess: () => void;
}

// "es, MX" -> ["ES","MX"] (sin duplicados); invalid lista los códigos mal formados.
function parseCountries(text: string) {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    if (!/^[A-Z]{2}$/.test(code)) invalid.push(raw);
    else if (!codes.includes(code)) codes.push(code);
  }
  return { codes, invalid };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

// Blanco o negro según la luminancia relativa (WCAG) del color de fondo.
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#FFFFFF";
}

export default function BonusModal(props: BonusModalProps) {
  // La clave reinicia el formulario al cambiar de bono o al reabrir.
  return (
    <BonusModalInner
      key={`${props.isOpen}-${props.bonus?.id ?? "new"}`}
      {...props}
    />
  );
}

function BonusModalInner({
  isOpen,
  bonus,
  nextPosition,
  onClose,
  onSuccess,
}: BonusModalProps) {
  const [form, setForm] = useState({
    casino_name: bonus?.casino_name ?? "",
    offer: bonus?.offer ?? "",
    description: bonus?.description ?? "",
    url: bonus?.url ?? "",
    image: bonus?.image ?? "",
    color: bonus?.color ?? "",
    button_text: bonus?.button_text ?? "",
    conditions: bonus?.conditions ?? "",
    verify_min_deposit: String(bonus?.verify_min_deposit ?? 30),
    featured: bonus?.featured ?? false,
    countries: (bonus?.countries ?? []).join(", "),
    blocked_countries: (bonus?.blocked_countries ?? []).join(", "),
    position: String(bonus?.position ?? nextPosition),
    is_active: bonus?.is_active ?? true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const colorValid = form.color === "" || HEX.test(form.color);
  const colorOk = HEX.test(form.color) ? form.color : null;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/admin/uploads/bonus-logo", {
        method: "POST",
        body: data,
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.url) {
        setForm((f) => ({ ...f, image: payload.url }));
      } else {
        setUploadError(payload?.message ?? "No se pudo subir el logo");
      }
    } catch {
      setUploadError("No se pudo subir el logo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const allowed = parseCountries(form.countries);
  const blocked = parseCountries(form.blocked_countries);
  const overlap = allowed.codes.filter((c) => blocked.codes.includes(c));
  const countryError = allowed.invalid.length
    ? `Código no válido: ${allowed.invalid.join(", ")}`
    : blocked.invalid.length
      ? `Código no válido: ${blocked.invalid.join(", ")}`
      : overlap.length
        ? `${overlap.join(", ")} está en las dos listas`
        : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countryError || !colorValid || uploading) return;
    setIsLoading(true);

    try {
      const response = await fetch(
        bonus ? `/api/admin/bonuses/${bonus.id}` : "/api/admin/bonuses",
        {
          method: bonus ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            casino_name: form.casino_name,
            offer: form.offer,
            description: form.description,
            url: form.url,
            image: form.image,
            color: form.color,
            button_text: form.button_text,
            conditions: form.conditions,
            verify_min_deposit: Math.max(1, parseInt(form.verify_min_deposit) || 30),
            featured: form.featured,
            countries: allowed.codes,
            blocked_countries: blocked.codes,
            position: parseInt(form.position) || 0,
            is_active: form.is_active,
          }),
        }
      );

      if (response.ok) {
        onSuccess();
      } else {
        const error = await response.json().catch(() => null);
        alert(`Error: ${error?.error ?? "No se pudo guardar el bono"}`);
      }
    } catch (error) {
      console.error("Error saving bonus:", error);
      alert("Error al guardar el bono");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bonus ? "Editar bono" : "Nuevo bono"}</DialogTitle>
          <DialogDescription>
            Los casinos activos aparecen en la página de bonos de la web.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="casino_name">Casino</Label>
            <Input
              id="casino_name"
              value={form.casino_name}
              onChange={(e) => setForm({ ...form, casino_name: e.target.value })}
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer">Texto del bono</Label>
            <Input
              id="offer"
              value={form.offer}
              onChange={(e) => setForm({ ...form, offer: e.target.value })}
              placeholder="30€ gratis + 200€"
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción (opcional)</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="url">URL de afiliado</Label>
            <Input
              id="url"
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://..."
            />
            <p className="text-xs text-muted-foreground">
              Sin URL de afiliado, el botón no se
              muestra en la web.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image">Logo (opcional)</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-black/20">
                {form.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.image}
                    alt="Vista previa del logo"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Sin logo</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? "Subiendo..." : "Subir logo"}
                </Button>
                {form.image && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => setForm({ ...form, image: "" })}
                  >
                    Quitar logo
                  </Button>
                )}
              </div>
            </div>
            {uploadError && (
              <p className="text-xs text-red-500">{uploadError}</p>
            )}
            <Input
              id="image"
              type="url"
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="o pega una URL https://..."
            />
            <p className="text-xs text-muted-foreground">
              PNG, JPG o WebP, máximo 1 MB.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="color_hex">Color del casino</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                aria-label="Selector de color"
                value={colorOk ?? "#7C3AED"}
                onChange={(e) =>
                  setForm({ ...form, color: e.target.value.toUpperCase() })
                }
                className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <Input
                id="color_hex"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value.trim() })}
                placeholder="#RRGGBB"
                maxLength={7}
                className="w-32"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setForm({ ...form, color: "" })}
              >
                Sin color
              </Button>
            </div>
            {!colorValid && (
              <p className="text-xs text-red-500">
                El color debe tener formato #RRGGBB
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="button_text">Texto del botón</Label>
            <Input
              id="button_text"
              value={form.button_text}
              onChange={(e) => setForm({ ...form, button_text: e.target.value })}
              placeholder="Reclamar bono"
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="conditions">Condiciones (opcional)</Label>
            <Textarea
              id="conditions"
              value={form.conditions}
              onChange={(e) => setForm({ ...form, conditions: e.target.value })}
              placeholder="Solo nuevos clientes. Depósito mínimo 10 €..."
              maxLength={300}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Texto corto que se muestra al lado de la oferta.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="verify_min_deposit">Depósito mínimo para verificar (€)</Label>
            <Input
              id="verify_min_deposit"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={form.verify_min_deposit}
              onChange={(e) => setForm({ ...form, verify_min_deposit: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Primer depósito que pide este casino para verificar la cuenta. La web y el panel de
              Verificaciones leen esta cifra.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Vista previa</Label>
            <div
              className="flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center"
              style={
                colorOk
                  ? {
                      borderColor: colorOk,
                      background: `linear-gradient(135deg, ${colorOk}, rgba(0,0,0,0.55))`,
                      color: "#fff",
                    }
                  : undefined
              }
            >
              <p className="text-lg font-extrabold uppercase italic">
                {form.casino_name || "Casino"}
              </p>
              <p className="text-xl font-extrabold italic">
                {form.offer || "Texto del bono"}
              </p>
              <span
                className="rounded-md px-6 py-2 text-sm font-bold"
                style={
                  colorOk
                    ? { backgroundColor: colorOk, color: textOn(colorOk) }
                    : { backgroundColor: "#7C3AED", color: "#fff" }
                }
              >
                {form.button_text.trim() || "Reclamar bono"}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="countries">Países con licencia</Label>
            <Input
              id="countries"
              value={form.countries}
              onChange={(e) => setForm({ ...form, countries: e.target.value })}
              placeholder="ES, MX, AR"
            />
            <p className="text-xs text-muted-foreground">
              Códigos de 2 letras separados por comas. Vacío = no se muestra en ningún país. Andorra (AD) queda siempre oculto, aunque lo añadas.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="blocked_countries">Países bloqueados</Label>
            <Input
              id="blocked_countries"
              value={form.blocked_countries}
              onChange={(e) =>
                setForm({ ...form, blocked_countries: e.target.value })
              }
              placeholder="US, GB"
            />
            <p className="text-xs text-muted-foreground">
              Tienen prioridad sobre los países con licencia. Si no se detecta el
              país del visitante, se trata como España (ES).
            </p>
            {countryError && (
              <p className="text-xs text-red-500">{countryError}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="space-y-2">
              <Label htmlFor="position">Orden</Label>
              <Input
                id="position"
                type="number"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                className="w-28"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked === true })
                }
              />
              <Label htmlFor="is_active">Activo</Label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox
                id="featured"
                checked={form.featured}
                onCheckedChange={(checked) =>
                  setForm({ ...form, featured: checked === true })
                }
              />
              <Label htmlFor="featured">Destacado</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || uploading || !!countryError || !colorValid}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
