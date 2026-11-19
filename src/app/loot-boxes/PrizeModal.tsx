"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RARITIES,
  RARITY_LABELS,
  type AdminBox,
  type PrizeKind,
  type PrizeRow,
  type Rarity,
} from "@/app/utils/lootBoxes/types";

import ImageField from "./ImageField";
import { RARITY_STYLES, errorMessage, selectClass } from "./shared";

export default function PrizeModal({
  box,
  prize,
  onClose,
  onSaved,
}: {
  box: AdminBox;
  prize: PrizeRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    rarity: (prize?.rarity ?? "common") as Rarity,
    kind: (prize?.kind ?? "points") as PrizeKind,
    name: prize?.name ?? "",
    description: prize?.description ?? "",
    image: prize?.image ?? "",
    points: prize?.points != null ? String(prize.points) : "",
    weight: String(prize?.weight ?? 1),
    stock: prize?.stock != null ? String(prize.stock) : "",
    fallback_points: prize?.fallback_points != null ? String(prize.fallback_points) : "",
    position: String(prize?.position ?? 0),
    is_active: prize?.is_active ?? true,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Probabilidad real de este premio en la caja: la de su categoría repartida
  // entre los premios activos de esa categoría según su peso.
  const myWeight = form.is_active ? Math.max(0, Number(form.weight) || 0) : 0;
  const othersWeight = box.prizes
    .filter((p) => p.rarity === form.rarity && p.is_active && p.id !== prize?.id)
    .reduce((sum, p) => sum + p.weight, 0);
  const rarityPct = box[`weight_${form.rarity}` as const] / 100;
  const realPct = myWeight + othersWeight > 0 ? (rarityPct * myWeight) / (myWeight + othersWeight) : 0;

  const setRarity = (rarity: Rarity) =>
    setForm((f) => ({ ...f, rarity, kind: rarity === "common" ? "points" : f.kind }));

  const liveIssue =
    form.kind === "points" && !(Number(form.points) >= 1)
      ? "Un premio de puntos necesita un valor de al menos 1."
      : form.stock.trim() !== "" && !(Number(form.fallback_points) >= 1)
        ? "Un premio con stock necesita puntos de respaldo (al menos 1)."
        : !(Number(form.weight) >= 1)
        ? "El peso debe ser al menos 1."
        : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setServerError(null);
    try {
      const response = await fetch(
        prize ? `/api/admin/loot-boxes/prizes/${prize.id}` : `/api/admin/loot-boxes/${box.id}/prizes`,
        {
          method: prize ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rarity: form.rarity,
            kind: form.kind,
            name: form.name,
            description: form.description,
            image: form.image,
            points: form.kind === "points" ? Number(form.points) : null,
            weight: Number(form.weight),
            stock: form.stock.trim() === "" ? null : Number(form.stock),
            fallback_points:
              form.stock.trim() === "" || form.fallback_points.trim() === ""
                ? null
                : Number(form.fallback_points),
            position: Number(form.position),
            is_active: form.is_active,
          }),
        }
      );
      if (!response.ok) {
        setServerError(await errorMessage(response, "Error guardando el premio"));
        return;
      }
      toast.success(prize ? "Premio actualizado" : "Premio creado");
      onSaved();
    } catch (error) {
      console.error("Error saving prize:", error);
      setServerError("Error de conexión");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{prize ? "Editar premio" : "Nuevo premio"}</DialogTitle>
          <DialogDescription>Caja: {box.name}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Categoría</Label>
            <div className="col-span-3 flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${RARITY_STYLES[form.rarity].dot}`} />
              <select
                className={selectClass}
                value={form.rarity}
                onChange={(e) => setRarity(e.target.value as Rarity)}
              >
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {RARITY_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Tipo</Label>
            <div className="col-span-3">
              <select
                className={selectClass}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as PrizeKind })}
              >
                <option value="points">Puntos</option>
                <option value="item" disabled={form.rarity === "common"}>
                  Objeto (entrega manual)
                </option>
              </select>
              {form.rarity === "common" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Un premio Común siempre es de puntos.
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Nombre</Label>
            <Input
              className="col-span-3"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">Descripción</Label>
            <Textarea
              className="col-span-3"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">Ilustración</Label>
            <div className="col-span-3">
              <ImageField
                value={form.image}
                onChange={(image) => setForm((f) => ({ ...f, image }))}
                onBusy={setUploading}
                emptyHint="Sin imagen, los premios de puntos salen con la moneda."
              />
            </div>
          </div>
          {form.kind === "points" && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Puntos</Label>
              <Input
                type="number"
                min={1}
                className="col-span-3"
                value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })}
                required
              />
            </div>
          )}
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">Peso</Label>
            <div className="col-span-3">
              <Input
                type="number"
                min={1}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Peso relativo dentro de su categoría (2 sale el doble que 1). Con este peso, el premio
                sale en el{" "}
                <span className="font-medium text-foreground">
                  {realPct.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %
                </span>{" "}
                de las aperturas de la caja.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">Stock</Label>
            <div className="col-span-3">
              <Input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Vacío = ilimitado. Un premio agotado sigue pudiendo salir: entonces da sus puntos de respaldo.
              </p>
            </div>
          </div>
          {form.stock.trim() !== "" && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="pt-2 text-right">Puntos de respaldo</Label>
              <div className="col-span-3">
                <Input
                  type="number"
                  min={1}
                  value={form.fallback_points}
                  onChange={(e) => setForm({ ...form, fallback_points: e.target.value })}
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Obligatorio con stock. Se abonan en lugar del premio cuando el stock llega a 0.
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Posición</Label>
            <Input
              type="number"
              className="col-span-3"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Activo</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })}
              />
              <span className="text-sm">Puede tocar al abrir la caja</span>
            </div>
          </div>

          {liveIssue && <p className="text-xs text-destructive">{liveIssue}</p>}
          {serverError && (
            <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || uploading || liveIssue !== null}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
