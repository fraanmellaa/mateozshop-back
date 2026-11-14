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
    countries: (bonus?.countries ?? []).join(", "),
    blocked_countries: (bonus?.blocked_countries ?? []).join(", "),
    position: String(bonus?.position ?? nextPosition),
    is_active: bonus?.is_active ?? true,
  });
  const [isLoading, setIsLoading] = useState(false);

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
    if (countryError) return;
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
      <DialogContent className="sm:max-w-[520px]">
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
              Sin URL de afiliado, el botón &quot;Reclamar bono&quot; no se
              muestra en la web.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image">URL del logo (opcional)</Label>
            <Input
              id="image"
              type="url"
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="countries">Países permitidos</Label>
            <Input
              id="countries"
              value={form.countries}
              onChange={(e) => setForm({ ...form, countries: e.target.value })}
              placeholder="ES, MX, AR"
            />
            <p className="text-xs text-muted-foreground">
              Códigos de 2 letras separados por comas. Vacío = todos los países.
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
              Tienen prioridad sobre los permitidos. Si no se detecta el país
              del visitante, solo se muestran los bonos sin lista de permitidos.
            </p>
            {countryError && (
              <p className="text-xs text-red-500">{countryError}</p>
            )}
          </div>
          <div className="flex items-center gap-6">
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !!countryError}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
