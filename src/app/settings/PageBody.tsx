"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExtensionSettings,
  SettingsIssue,
  extensionSettingsSchema,
  plinkoRtp,
  settingsIssues,
} from "@/app/utils/settings/schema";

type FieldKind = "number" | "list";
type Field = { path: string; label: string; kind: FieldKind; help?: string };

const SECTIONS: { title: string; description: string; fields: Field[] }[] = [
  {
    title: "Puntos por ver el directo",
    description: "El servidor da los puntos con su propio reloj; la extensión solo avisa de que sigue ahí.",
    fields: [
      { path: "watch.intervalSeconds", label: "Intervalo (segundos)", kind: "number" },
      { path: "watch.pointsPerInterval", label: "Puntos por intervalo", kind: "number" },
      {
        path: "watch.dailyCap",
        label: "Tope diario de puntos",
        kind: "number",
        help: "Vacío = sin tope.",
      },
    ],
  },
  {
    title: "Minas",
    description: "El retorno esperado del jugador es el borde de la casa (0.97 = devuelve el 97 %).",
    fields: [
      { path: "mines.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "mines.maxBet", label: "Apuesta máxima", kind: "number" },
      {
        path: "mines.boardSizes",
        label: "Tamaños de tablero",
        kind: "list",
        help: "Separados por comas.",
      },
      { path: "mines.maxMinePercent", label: "Máx. proporción de minas", kind: "number" },
      { path: "mines.houseEdge", label: "Borde de la casa", kind: "number", help: "Máximo 0.99." },
      { path: "mines.maxMultiplier", label: "Multiplicador máximo", kind: "number" },
    ],
  },
  {
    title: "Crash",
    description: "El retorno esperado del jugador es, como mucho, el borde de la casa.",
    fields: [
      { path: "crash.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "crash.maxBet", label: "Apuesta máxima", kind: "number" },
      { path: "crash.houseEdge", label: "Borde de la casa", kind: "number", help: "Máximo 1." },
      { path: "crash.maxMultiplier", label: "Multiplicador máximo", kind: "number" },
      { path: "crash.growthPerTick", label: "Crecimiento por tick", kind: "number" },
      { path: "crash.tickMs", label: "Duración del tick (ms)", kind: "number" },
    ],
  },
  {
    title: "Plinko",
    description: "Cada casilla tiene un multiplicador y un peso (probabilidad relativa de caer en ella).",
    fields: [
      { path: "plinko.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "plinko.maxBet", label: "Apuesta máxima", kind: "number" },
      {
        path: "plinko.multipliers",
        label: "Multiplicadores",
        kind: "list",
        help: "Separados por comas, de izquierda a derecha.",
      },
      {
        path: "plinko.weights",
        label: "Pesos",
        kind: "list",
        help: "Enteros, uno por multiplicador. No se envían a la extensión.",
      },
    ],
  },
];

const FIELDS = SECTIONS.flatMap((section) => section.fields);

function toForm(settings: ExtensionSettings): Record<string, string> {
  const form: Record<string, string> = {};
  for (const { path } of FIELDS) {
    const [section, key] = path.split(".");
    const value = (settings as Record<string, Record<string, unknown>>)[section][key];
    form[path] = Array.isArray(value) ? value.join(", ") : value === null ? "" : String(value);
  }
  return form;
}

const toNumber = (text: string) => (text.trim() === "" ? NaN : Number(text.replace(",", ".")));

const toList = (text: string) =>
  text
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);

/** Convierte el formulario en el objeto que valida el esquema. */
function fromForm(form: Record<string, string>, requireLive: boolean) {
  const out: Record<string, Record<string, unknown>> = {
    watch: { requireLive },
    mines: {},
    crash: {},
    plinko: {},
  };
  for (const { path, kind } of FIELDS) {
    const [section, key] = path.split(".");
    const text = form[path];
    if (path === "watch.dailyCap" && text.trim() === "") out[section][key] = null;
    else out[section][key] = kind === "list" ? toList(text) : toNumber(text);
  }
  return out;
}

export default function PageBody({
  settings,
  defaults,
}: {
  settings: ExtensionSettings;
  defaults: ExtensionSettings;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toForm(settings));
  const [requireLive, setRequireLive] = useState(settings.watch.requireLive);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const multipliers = toList(form["plinko.multipliers"]);
  const weights = toList(form["plinko.weights"]);
  const rtpKnown =
    multipliers.length === weights.length &&
    multipliers.length > 0 &&
    [...multipliers, ...weights].every((n) => Number.isFinite(n) && n >= 0);
  const rtp = rtpKnown ? plinkoRtp(multipliers, weights) : null;

  const issuesFor = (path: string) =>
    issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = extensionSettingsSchema.safeParse(fromForm(form, requireLive));
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error));
      toast.error("Hay valores que no son válidos");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/settings/extension", {
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
      toast.success("Ajustes guardados. La extensión los aplica en menos de un minuto.");
      router.refresh();
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Error de conexión");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreDefaults = () => {
    setForm(toForm(defaults));
    setRequireLive(defaults.watch.requireLive);
    setIssues([]);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-3xl space-y-6">
      {SECTIONS.map((section) => (
        <section key={section.title} className="rounded-md border p-4">
          <h2 className="text-base font-semibold">{section.title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{section.description}</p>

          <div className="space-y-4">
            {section.fields.map((field) => {
              const fieldIssues = issuesFor(field.path);
              return (
                <div key={field.path} className="grid grid-cols-4 items-start gap-4">
                  <Label htmlFor={field.path} className="pt-2 text-right">
                    {field.label}
                  </Label>
                  <div className="col-span-3">
                    <Input
                      id={field.path}
                      inputMode={field.kind === "number" ? "decimal" : "text"}
                      value={form[field.path]}
                      aria-invalid={fieldIssues.length > 0}
                      onChange={(e) => setForm({ ...form, [field.path]: e.target.value })}
                    />
                    {field.help && (
                      <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>
                    )}
                    {fieldIssues.map((issue, i) => (
                      <p key={i} className="mt-1 text-xs text-destructive">
                        {issue.message}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}

            {section.title === "Puntos por ver el directo" && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Exigir directo</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Checkbox
                    checked={requireLive}
                    onCheckedChange={(v) => setRequireLive(Boolean(v))}
                  />
                  <span className="text-sm">
                    Solo dar puntos cuando el canal está en directo
                  </span>
                </div>
              </div>
            )}

            {section.title === "Plinko" && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Retorno esperado</Label>
                <div className="col-span-3 text-sm">
                  {rtp === null ? (
                    <span className="text-muted-foreground">
                      Introduce el mismo número de multiplicadores que de pesos.
                    </span>
                  ) : (
                    <span className={rtp > 1 ? "font-medium text-destructive" : "font-medium"}>
                      {(rtp * 100).toFixed(1)} %
                      {rtp > 1 && " — por encima del 100 % el juego regala puntos; no se puede guardar"}
                    </span>
                  )}
                </div>
              </div>
            )}

          </div>
        </section>
      ))}

      {issues.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
          <p className="font-medium">No se ha guardado. Revisa estos valores:</p>
          <ul className="mt-2 list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>
                {FIELDS.find(
                  (f) => issue.path === f.path || issue.path.startsWith(`${f.path}.`)
                )?.label ?? issue.path}
                : {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleRestoreDefaults}>
          Valores por defecto
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Guardando..." : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}
