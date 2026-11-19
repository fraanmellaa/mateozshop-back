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
import { boxRuleIssues, WEIGHT_FIELDS, weightsSum } from "@/app/utils/lootBoxes/rules";
import { RARITY_LABELS, WEIGHTS_TOTAL, type AdminBox } from "@/app/utils/lootBoxes/types";

import ImageField from "./ImageField";
import { errorMessage } from "./shared";

const num = (text: string) => (text.trim() === "" ? NaN : Number(text));

// En el formulario las probabilidades se escriben en porcentaje (70, 22,5...);
// se guardan en puntos básicos (7000, 2250), que es como las usa el sorteo.
const toPct = (weight: number) => String(weight / 100);
const fmtPct = (weight: number) => (weight / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 });
const toWeight = (text: string) => {
  const pct = num(text.replace(",", "."));
  return Number.isFinite(pct) ? Math.round(pct * 100) : NaN;
};

export default function BoxModal({
  box,
  onClose,
  onSaved,
}: {
  box: AdminBox | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: box?.name ?? "",
    description: box?.description ?? "",
    image: box?.image ?? "",
    price: String(box?.price ?? ""),
    weight_common: toPct(box?.weight_common ?? 7000),
    weight_rare: toPct(box?.weight_rare ?? 2200),
    weight_epic: toPct(box?.weight_epic ?? 700),
    weight_legendary: toPct(box?.weight_legendary ?? 100),
    position: String(box?.position ?? 0),
    is_active: box?.is_active ?? false,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const weights = {
    weight_common: toWeight(form.weight_common),
    weight_rare: toWeight(form.weight_rare),
    weight_epic: toWeight(form.weight_epic),
    weight_legendary: toWeight(form.weight_legendary),
  };
  const sum = weightsSum(weights);
  const sumOk = sum === WEIGHTS_TOTAL;
  // Con los premios actuales de la caja: avisa de qué falta para tenerla activa.
  const issues = boxRuleIssues({ ...weights, is_active: form.is_active }, box?.prizes ?? []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setServerError(null);
    try {
      const response = await fetch(box ? `/api/admin/loot-boxes/${box.id}` : "/api/admin/loot-boxes", {
        method: box ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          image: form.image,
          price: num(form.price),
          ...weights,
          position: num(form.position),
          is_active: form.is_active,
        }),
      });
      if (!response.ok) {
        setServerError(await errorMessage(response, "Error guardando la caja"));
        return;
      }
      toast.success(box ? "Caja actualizada" : "Caja creada");
      onSaved();
    } catch (error) {
      console.error("Error saving loot box:", error);
      setServerError("Error de conexión");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{box ? "Editar caja" : "Nueva caja"}</DialogTitle>
          <DialogDescription>
            Pon la probabilidad de cada categoría en porcentaje: las cuatro tienen que sumar 100 %.
            Dentro de cada categoría, el premio se reparte según el peso de cada premio.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                emptyHint="Sin imagen, la web dibuja una caja con su color."
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Precio (pts)</Label>
            <Input
              type="number"
              min={1}
              className="col-span-3"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
            {WEIGHT_FIELDS.map(({ key, rarity }) => {
              return (
                <div key={key} className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">{RARITY_LABELS[rarity]}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    required
                  />
                  <span className="col-span-2 text-sm text-muted-foreground">% de las aperturas</span>
                </div>
              );
            })}
            <div
              className={`text-sm font-medium ${sumOk ? "text-green-400" : "text-destructive"}`}
              aria-live="polite"
            >
              Suma: {Number.isFinite(sum) ? `${fmtPct(sum)} %` : "—"} de 100 %
              {sumOk
                ? " — correcto"
                : Number.isFinite(sum)
                  ? sum > WEIGHTS_TOTAL
                    ? ` — sobra un ${fmtPct(sum - WEIGHTS_TOTAL)} %`
                    : ` — falta un ${fmtPct(WEIGHTS_TOTAL - sum)} %`
                  : " — rellena los cuatro porcentajes"}
            </div>
          </div>

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
            <Label className="text-right">Activa</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })}
              />
              <span className="text-sm">Visible y abrible en la tienda</span>
            </div>
          </div>

          {issues.filter((i) => i.code !== "INVALID_WEIGHTS_SUM").length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {issues
                .filter((i) => i.code !== "INVALID_WEIGHTS_SUM")
                .map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
            </ul>
          )}
          {serverError && (
            <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || uploading || !sumOk}>
              {isLoading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
