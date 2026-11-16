"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GamesSettings,
  MAX_RTP,
  SettingsIssue,
  gamesSettingsSchema,
  settingsIssues,
} from "@/app/utils/settings/schema";
import { OUTER_LEN, PLINKO_LEVEL_IDS, PlinkoLevelId, buildTable, rtpOf } from "@/app/utils/games/table";
import { MINES_DEFAULT, minesRealRtp, minesTableCents } from "@/app/utils/games/minesTable";

type FieldKind = "number" | "list" | "text";
type Field = { path: string; label: string; kind: FieldKind; help?: string };

const LEVEL_NAMES: Record<PlinkoLevelId, string> = {
  facil: "Fácil",
  medio: "Medio",
  hard: "Hard",
  extreme: "Extreme",
};

const levelFields = (id: PlinkoLevelId): Field[] => [
  { path: `plinko.levels.${id}.rtp`, label: "RTP objetivo", kind: "number", help: "Entre 0 y 0.99 (0.90 = devuelve el 90 %)." },
  {
    path: `plinko.levels.${id}.outer`,
    label: "Multiplicadores de borde",
    kind: "list",
    help: `${OUTER_LEN} valores, de la casilla de fuera hacia dentro (la tabla es simétrica). El centro se calcula solo para cuadrar el RTP.`,
  },
  {
    path: `plinko.levels.${id}.maxBet`,
    label: "Apuesta máxima del nivel",
    kind: "number",
    help: "Vacío = la apuesta máxima general. Se aplica la menor de las dos.",
  },
];

const SECTIONS: { title: string; description: string; fields: Field[]; level?: PlinkoLevelId; mines?: boolean }[] = [
  {
    title: "Crash",
    description:
      "Con retirada automática en el objetivo del jugador. El RTP es el mismo para cualquier objetivo (el real queda algo por debajo por los redondeos).",
    fields: [
      { path: "crash.rtp", label: "RTP", kind: "number", help: "Entre 0 y 0.99." },
      { path: "crash.maxMult", label: "Multiplicador máximo", kind: "number" },
      { path: "crash.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "crash.maxBet", label: "Apuesta máxima", kind: "number" },
    ],
  },
  {
    title: "Plinko: límites generales",
    description: "Plinko de 16 filas. Cada nivel tiene su propio RTP y bordes (abajo).",
    fields: [
      { path: "plinko.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "plinko.maxBet", label: "Apuesta máxima", kind: "number" },
      { path: "plinko.maxBalls", label: "Bolas por tirada (turbo)", kind: "number", help: "De 1 a 100." },
    ],
  },
  ...PLINKO_LEVEL_IDS.map((id) => ({
    title: `Plinko ${LEVEL_NAMES[id]}`,
    description: "Más premio máximo = menos RTP. El RTP real de la tabla se calcula en vivo.",
    fields: levelFields(id),
    level: id,
  })),
  {
    title: "Buscaminas",
    description:
      "Tablero de 25 casillas y de 1 a 24 minas. El multiplicador tras k casillas seguras es RTP × C(25,k) / C(25−minas,k), truncado a 2 decimales: plantarse en cualquier momento devuelve como mucho el RTP. Al llegar al multiplicador máximo se cobra sola.",
    fields: [
      { path: "mines.rtp", label: "RTP", kind: "number", help: "Entre 0 y 0.99." },
      { path: "mines.maxMult", label: "Multiplicador máximo", kind: "number" },
      { path: "mines.minBet", label: "Apuesta mínima", kind: "number" },
      { path: "mines.maxBet", label: "Apuesta máxima", kind: "number" },
    ],
    mines: true,
  },
  {
    title: "Torneo semanal",
    description:
      "Se aplica a los torneos que se creen a partir de ahora: cada torneo guarda su propia tabla. Las fichas no son puntos.",
    fields: [
      { path: "tournament.level", label: "Nivel de Plinko", kind: "text", help: "facil, medio, hard o extreme." },
      { path: "tournament.spinsPerEntry", label: "Tiradas por participante", kind: "number" },
      { path: "tournament.chipsPerSpin", label: "Fichas por tirada", kind: "number" },
    ],
  },
];

const FIELDS = SECTIONS.flatMap((section) => section.fields);

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  keys.slice(0, -1).forEach((k) => {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  });
  cur[keys[keys.length - 1]] = value;
}

function toForm(settings: GamesSettings): Record<string, string> {
  const form: Record<string, string> = {};
  for (const { path } of FIELDS) {
    const value = getPath(settings, path);
    form[path] = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
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
function fromForm(form: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const { path, kind } of FIELDS) {
    const text = form[path];
    if (path.endsWith(".maxBet") && path.startsWith("plinko.levels.") && text.trim() === "") continue;
    setPath(out, path, kind === "list" ? toList(text) : kind === "text" ? text.trim() : toNumber(text));
  }
  return out;
}

/** Tabla de ejemplo (3 minas) con el RTP y el máximo del formulario. */
function minesPreview(form: Record<string, string>) {
  const rtp = toNumber(form["mines.rtp"]);
  const maxMult = toNumber(form["mines.maxMult"]);
  if (!(rtp > 0 && rtp <= 1) || !(maxMult >= 1.01)) return null;
  const table = minesTableCents(MINES_DEFAULT, rtp, maxMult);
  return { table: table.map((c) => (c / 100).toFixed(2)), real: minesRealRtp(MINES_DEFAULT, table) };
}

function levelPreview(form: Record<string, string>, id: PlinkoLevelId) {
  const outer = toList(form[`plinko.levels.${id}.outer`]);
  const rtp = toNumber(form[`plinko.levels.${id}.rtp`]);
  if (outer.length !== OUTER_LEN || !outer.every((n) => Number.isFinite(n) && n >= 0) || !(rtp > 0)) return null;
  const table = buildTable(outer, rtp);
  return { table, real: rtpOf(table), target: rtp };
}

export default function PageBody({
  settings,
  defaults,
}: {
  settings: GamesSettings;
  defaults: GamesSettings;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toForm(settings));
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const issuesFor = (path: string) =>
    issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));

  const labelFor = (path: string) =>
    FIELDS.find((f) => path === f.path || path.startsWith(`${f.path}.`))?.label ?? path;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = gamesSettingsSchema.safeParse(fromForm(form));
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error));
      toast.error("Hay valores que no son válidos");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/settings/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setIssues(result?.issues ?? []);
        toast.error(
          result?.error === "INVALID_SETTINGS"
            ? "El servidor ha rechazado algunos valores"
            : "Error guardando los ajustes"
        );
        return;
      }

      setIssues([]);
      toast.success("Ajustes guardados. Se aplican en menos de un minuto.");
      router.refresh();
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Error de conexión");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-3xl space-y-6">
      {SECTIONS.map((section) => {
        const preview = section.level ? levelPreview(form, section.level) : null;
        return (
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
                      {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
                      {fieldIssues.map((issue, i) => (
                        <p key={i} className="mt-1 text-xs text-destructive">
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}

              {section.level && (
                <div className="grid grid-cols-4 items-start gap-4">
                  <Label className="pt-0.5 text-right">RTP real de la tabla</Label>
                  <div className="col-span-3 text-sm">
                    {preview === null ? (
                      <span className="text-muted-foreground">
                        Introduce {OUTER_LEN} multiplicadores y un RTP para ver la tabla.
                      </span>
                    ) : (
                      <>
                        <span
                          className={
                            preview.real > MAX_RTP || preview.real > preview.target + 1e-9
                              ? "font-medium text-destructive"
                              : "font-medium"
                          }
                        >
                          {(preview.real * 100).toFixed(2)} %
                          {(preview.real > MAX_RTP || preview.real > preview.target + 1e-9) &&
                            " — por encima del objetivo: baja los bordes, no se podrá guardar"}
                        </span>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          Tabla (17 casillas): {preview.table.join(" · ")}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {section.mines && (
                <div className="grid grid-cols-4 items-start gap-4">
                  <Label className="pt-0.5 text-right">Tabla con {MINES_DEFAULT} minas</Label>
                  <div className="col-span-3 text-sm">
                    {(() => {
                      const mines = minesPreview(form);
                      if (mines === null) {
                        return <span className="text-muted-foreground">Introduce un RTP y un multiplicador máximo.</span>;
                      }
                      return (
                        <>
                          <span className="font-medium">RTP real máximo: {(mines.real * 100).toFixed(2)} %</span>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            Tras 1, 2, 3… casillas seguras: {mines.table.join(" · ")}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {issues.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
          <p className="font-medium">No se ha guardado. Revisa estos valores:</p>
          <ul className="mt-2 list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>
                {labelFor(issue.path)}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => { setForm(toForm(defaults)); setIssues([]); }}>
          Valores por defecto
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Guardando..." : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}
