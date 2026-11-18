"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SettingsIssue,
  ShopSettings,
  shopSettingsIssues,
  shopSettingsSchema,
} from "@/app/utils/shop/schema";

type Field = { key: keyof ShopSettings; label: string; help?: string };

const FIELDS: Field[] = [
  { key: "battleMinutes", label: "Duración de la puja (min)", help: "Cuenta atrás desde la primera puja." },
  { key: "extendWindowMinutes", label: "Ventana de prórroga (min)", help: "Una puja en estos últimos minutos alarga la cuenta atrás." },
  { key: "extendMinutes", label: "Prórroga (min)", help: "Se suma al cierre actual." },
  { key: "minIncrementPct", label: "Subida mínima (%)", help: "Sobre la puja actual; como mínimo 1 punto." },
  { key: "maxWinsPerMonth", label: "Premios por persona y mes", help: "Mes de Andorra." },
  { key: "minAccountAgeDays", label: "Antigüedad mínima de cuenta (días)", help: "Kick o Twitch vinculado." },
  { key: "reviewThresholdEur", label: "Revisión manual desde (€)", help: "Los premios que valgan más se revisan antes de entregarse." },
  { key: "vipPointsPerMinute", label: "Puntos VIP por minuto: 1 casino", help: "Lo que gana por minuto de directo un verificado en un casino, además de sus puntos normales. 0 = no se reparten." },
  { key: "vipPointsPerMinuteTwo", label: "Puntos VIP por minuto: 2 casinos", help: "Verificado en dos casinos." },
  { key: "vipPointsPerMinuteThree", label: "Puntos VIP por minuto: 3 casinos o más", help: "Tope: a partir de tres casinos no sube más." },
  { key: "vipMonthlyReset", label: "Reiniciar puntos VIP cada mes", help: "1 = se ponen a cero el día 1, como los puntos normales. 0 = se conservan." },
];

// La apertura de las pujas VIP se guarda en segundos Unix y se edita como fecha y hora local.
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (seconds: number) => {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (text: string) => {
  const ms = text ? new Date(text).getTime() : 0;
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
};

const toNumber = (text: string) => (text.trim() === "" ? NaN : Number(text.replace(",", ".")));

export default function ShopSettingsPanel({
  settings,
  defaults,
}: {
  settings: ShopSettings;
  defaults: ShopSettings;
}) {
  const router = useRouter();
  const toForm = (s: ShopSettings) =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<string, string>;

  const [form, setForm] = useState(() => toForm(settings));
  const [vipOpens, setVipOpens] = useState(() => toLocalInput(settings.vipOpensAt));
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const issuesFor = (key: string) => issues.filter((i) => i.path === key);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = shopSettingsSchema.safeParse({
      ...Object.fromEntries(FIELDS.map((f) => [f.key, toNumber(form[f.key])])),
      vipOpensAt: fromLocalInput(vipOpens),
    });
    if (!parsed.success) {
      setIssues(shopSettingsIssues(parsed.error));
      toast.error("Hay valores que no son válidos");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/shop/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setIssues(result?.issues ?? []);
        toast.error(
          result?.error === "INVALID_SETTINGS"
            ? "Hay valores que no son válidos"
            : "Error guardando los ajustes"
        );
        return;
      }

      setIssues([]);
      toast.success("Ajustes de la tienda guardados");
      router.refresh();
    } catch (error) {
      console.error("Error saving shop settings:", error);
      toast.error("Error de conexión");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-md border p-4">
      <h2 className="text-base font-semibold">Reglas de las pujas</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Se aplican a todos los premios. Los cambios afectan a las pujas nuevas y a las
        adjudicaciones que queden por hacer.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <Label htmlFor={`shop-${field.key}`}>{field.label}</Label>
            <Input
              id={`shop-${field.key}`}
              inputMode="decimal"
              className="mt-1"
              value={form[field.key]}
              aria-invalid={issuesFor(field.key).length > 0}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
            />
            {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
            {issuesFor(field.key).map((issue, i) => (
              <p key={i} className="mt-1 text-xs text-destructive">
                {issue.message}
              </p>
            ))}
          </div>
        ))}
        <div>
          <Label htmlFor="shop-vipOpensAt">Apertura de las pujas VIP</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="shop-vipOpensAt"
              type="datetime-local"
              value={vipOpens}
              onChange={(e) => setVipOpens(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={() => setVipOpens(toLocalInput(Math.floor(Date.now() / 1000)))}>
              Ahora
            </Button>
            <Button type="button" variant="outline" onClick={() => setVipOpens("")}>
              Quitar
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            El último directo del mes. Hasta esa fecha los premios de verificados se ven con cuenta atrás
            y no se puede pujar. Sin fecha están cerradas; cada mes hay que poner la nueva.
          </p>
          {issuesFor("vipOpensAt").map((issue, i) => (
            <p key={i} className="mt-1 text-xs text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setForm(toForm(defaults));
            setVipOpens(toLocalInput(defaults.vipOpensAt));
            setIssues([]);
          }}
        >
          Valores por defecto
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Guardando..." : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}
