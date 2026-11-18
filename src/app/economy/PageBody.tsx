"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EconomyIssue,
  EconomySettings,
  economyIssues,
  economySettingsSchema,
} from "@/app/utils/economy/schema";

type Draft = Record<string, unknown>;

type LastReset = {
  month: string;
  closed_month: string;
  forced: boolean;
  started_at: number;
  completed_at: number | null;
  leaderboard_saved_at: number | null;
  auctions_closed_at: number | null;
  giveaways_closed_at: number | null;
  balances_reset_at: number | null;
  bonuses_granted_at: number | null;
  auctions_closed: number | null;
  giveaways_closed: number | null;
  users_reset: number | null;
  bonus_users: number | null;
  error: string | null;
} | null;

type BoardEntry = { position: number; username: string; points: number };

// Campos de texto: el resto de cadenas del formulario son números.
const TEXT_KEYS = new Set(["id", "label", "name", "kind"]);

/** Todos los números pasan a texto para poder editarlos libremente. */
function toDraft(value: unknown): unknown {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(toDraft);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toDraft(v)]));
  }
  return value;
}

/** Vuelve a números; un campo vacío queda como NaN (el esquema lo rechaza). */
function fromDraft(value: unknown, key = ""): unknown {
  if (typeof value === "string" && !TEXT_KEYS.has(key)) {
    if (key === "pointValueEur" && value.trim() === "") return undefined;
    return value.trim() === "" ? NaN : Number(value.replace(",", "."));
  }
  if (Array.isArray(value)) return value.map((v) => fromDraft(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromDraft(v, k)]));
  }
  return value;
}

function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function setAt(obj: unknown, path: string, value: unknown): Draft {
  const [head, ...rest] = path.split(".");
  const clone: Record<string, unknown> | unknown[] = Array.isArray(obj)
    ? [...obj]
    : { ...((obj as Record<string, unknown>) ?? {}) };
  const current = (clone as Record<string, unknown>)[head];
  (clone as Record<string, unknown>)[head] =
    rest.length === 0 ? value : setAt(current, rest.join("."), value);
  return clone as Draft;
}

const fmtDate = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleString("es-ES", { timeZone: "Europe/Andorra" }) : "—";

export default function PageBody({
  settings,
  defaults,
  month,
  board,
  lastReset,
}: {
  settings: EconomySettings;
  defaults: EconomySettings;
  month: string;
  board: BoardEntry[] | null;
  lastReset: LastReset;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings) as Draft);
  const [issues, setIssues] = useState<EconomyIssue[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const set = (path: string, value: unknown) => setDraft((d) => setAt(d, path, value));
  const list = (path: string) => (getAt(draft, path) as unknown[]) ?? [];

  const issuesFor = (path: string) =>
    issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));

  const num = (path: string, label: string, help?: string) => {
    const own = issues.filter((i) => i.path === path);
    return (
      <div key={path} className="grid grid-cols-4 items-start gap-4">
        <Label htmlFor={path} className="pt-2 text-right">
          {label}
        </Label>
        <div className="col-span-3">
          <Input
            id={path}
            inputMode="decimal"
            value={String(getAt(draft, path) ?? "")}
            aria-invalid={own.length > 0}
            onChange={(e) => set(path, e.target.value)}
          />
          {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
          {own.map((i, n) => (
            <p key={n} className="mt-1 text-xs text-destructive">
              {i.message}
            </p>
          ))}
        </div>
      </div>
    );
  };

  const text = (path: string, label: string) => (
    <div key={path} className="grid grid-cols-4 items-start gap-4">
      <Label htmlFor={path} className="pt-2 text-right">
        {label}
      </Label>
      <div className="col-span-3">
        <Input
          id={path}
          value={String(getAt(draft, path) ?? "")}
          onChange={(e) => set(path, e.target.value)}
        />
        {issues
          .filter((i) => i.path === path)
          .map((i, n) => (
            <p key={n} className="mt-1 text-xs text-destructive">
              {i.message}
            </p>
          ))}
      </div>
    </div>
  );

  const removeAt = (path: string, index: number) =>
    set(
      path,
      list(path).filter((_, i) => i !== index)
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = economySettingsSchema.safeParse(fromDraft(draft));
    if (!parsed.success) {
      setIssues(economyIssues(parsed.error));
      toast.error("Hay valores que no son válidos");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/economy/settings", {
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
      toast.success("Ajustes guardados");
      router.refresh();
    } catch (error) {
      console.error("Error saving economy settings:", error);
      toast.error("Error de conexión");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const response = await fetch("/api/admin/economy/monthly-reset", { method: "POST" });
      const result = await response.json().catch(() => null);
      const status = result?.data?.status;

      if (response.ok && status === "done") toast.success("Reinicio mensual completado");
      else if (status === "already_done") toast.info("El reinicio de este mes ya está hecho");
      else if (status === "locked") toast.error("Ya hay un reinicio en marcha");
      else if (status === "failed")
        toast.error(`El reinicio falló en «${result.data.step}»: ${result.data.error}`);
      else toast.error("No se pudo lanzar el reinicio");
    } catch (error) {
      console.error("Error launching monthly reset:", error);
      toast.error("Error de conexión");
    } finally {
      setIsResetting(false);
      setConfirmStep(0);
      setConfirmText("");
      router.refresh();
    }
  };

  const section = (title: string, description: string, children: React.ReactNode) => (
    <section className="rounded-md border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );

  const rowButtons = (path: string, index: number) => (
    <Button type="button" variant="outline" size="sm" onClick={() => removeAt(path, index)}>
      Quitar
    </Button>
  );

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {section(
          "Puntos por ver el directo",
          "Se pagan cada minuto a quien haya escrito en el chat dentro de la ventana, en Kick o Twitch (una sola vez por usuario).",
          <>
            {num("watch.pointsPerMinute", "Puntos por minuto")}
            {num("watch.chatWindowMinutes", "Ventana de chat (min)")}
            {num("minutes.streak", "Minutos para sumar racha", "Minutos vistos en un día de directo.")}
            {num("minutes.dailyBox", "Minutos para la caja diaria")}
          </>
        )}

        {section(
          "Antifarmeo del chat",
          "Un mensaje cuenta como actividad solo si cumple estas reglas.",
          <>
            {num("antiFarm.minLength", "Caracteres mínimos")}
            {num("antiFarm.minDistinctChars", "Letras o números distintos")}
            {num("antiFarm.repeatWindowSeconds", "Repetición (s)", "Un mismo texto no cuenta dos veces en este tiempo.")}
            {num("antiFarm.minGapSeconds", "Separación (s)", "Como mucho cuenta un mensaje cada N segundos.")}
          </>
        )}

        {section(
          "Racha y caja de racha",
          "La racha cuenta días de directo con los minutos necesarios; los días sin directo no la rompen y no se reinicia con el mes.",
          <>
            {num("streak.bonusFromDay", "Bonus desde el día")}
            {num("streak.bonusPct", "Bonus (%)", "Solo mientras la racha siga viva.")}
            {num("streak.boxEveryDays", "Caja cada N días")}
            <div className="space-y-2">
              <p className="text-sm font-medium">Tramos de la caja de racha</p>
              {list("streak.boxTiers").map((_, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  {num(`streak.boxTiers.${i}.points`, "Puntos")}
                  {num(`streak.boxTiers.${i}.weight`, "Peso (≈ %)")}
                  {rowButtons("streak.boxTiers", i)}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("streak.boxTiers", [...list("streak.boxTiers"), { points: "1000", weight: "1" }])}
              >
                Añadir tramo
              </Button>
              {issuesFor("streak.boxTiers").filter((i) => i.path === "streak.boxTiers").map((i, n) => (
                <p key={n} className="text-xs text-destructive">{i.message}</p>
              ))}
            </div>
          </>
        )}

        {section(
          "Caja diaria",
          "Una por día de directo. Los pesos van en puntos básicos y suman 10.000 (7500 = 75 %).",
          <>
            {list("dailyBox.tiers").map((tier, i) => {
              const t = tier as Record<string, unknown>;
              const isItem = t.kind === "item";
              return (
                <div key={String(t.id)} className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {String(t.id)} {isItem ? "(objeto)" : "(puntos)"}
                  </p>
                  {text(`dailyBox.tiers.${i}.label`, "Nombre")}
                  {num(`dailyBox.tiers.${i}.weight`, "Peso (de 10.000)")}
                  {isItem ? (
                    <>
                      {text(`dailyBox.tiers.${i}.name`, "Objeto")}
                      {num(`dailyBox.tiers.${i}.monthlyStock`, "Stock mensual")}
                      {num(`dailyBox.tiers.${i}.fallbackPoints`, "Puntos de respaldo", "Se dan si el objeto se ha agotado.")}
                    </>
                  ) : (
                    <>
                      {num(`dailyBox.tiers.${i}.pointsMin`, "Puntos mínimos")}
                      {num(`dailyBox.tiers.${i}.pointsMax`, "Puntos máximos")}
                    </>
                  )}
                </div>
              );
            })}
            {issues
              .filter((i) => i.path === "dailyBox.tiers")
              .map((i, n) => (
                <p key={n} className="text-xs text-destructive">{i.message}</p>
              ))}
          </>
        )}

        {section(
          "Lluvias",
          "Las lanza el streamer o un moderador con !lluvia y !maxwin. Máximo 0 = desactivada.",
          <>
            {(["lluvia", "maxwin"] as const).map((kind) => (
              <div key={kind} className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">!{kind}</p>
                {num(`rain.${kind}.points`, "Puntos por usuario")}
                {num(`rain.${kind}.windowMinutes`, "Ventana de chat (min)")}
                {num(`rain.${kind}.maxPerStream`, "Máximo por directo")}
              </div>
            ))}
          </>
        )}

        {section(
          "Leaderboard mensual",
          "Puntos que recibe cada tramo de puestos al empezar el mes siguiente.",
          <>
            {list("leaderboard.scale").map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                {num(`leaderboard.scale.${i}.from`, "Desde")}
                {num(`leaderboard.scale.${i}.to`, "Hasta")}
                {num(`leaderboard.scale.${i}.points`, "Puntos")}
                {rowButtons("leaderboard.scale", i)}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set("leaderboard.scale", [
                  ...list("leaderboard.scale"),
                  { from: "1", to: "1", points: "0", multiplierPct: "0" },
                ])
              }
            >
              Añadir tramo
            </Button>
            {issues
              .filter((i) => i.path === "leaderboard.scale")
              .map((i, n) => (
                <p key={n} className="text-xs text-destructive">{i.message}</p>
              ))}
          </>
        )}

        {section(
          "Otros",
          "El valor del punto es solo informativo (se muestra en las bases legales).",
          <>
            {num("pointValueEur", "Valor del punto (€)", "Vacío = no se publica.")}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Reinicio mensual</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Checkbox
                  checked={Boolean(getAt(draft, "monthlyReset.enabled"))}
                  onCheckedChange={(v) => set("monthlyReset.enabled", Boolean(v))}
                />
                <span className="text-sm">Automático el día 1 a las 00:00 (hora de Andorra)</span>
              </div>
            </div>
          </>
        )}

        {issues.length > 0 && (
          <div className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
            <p className="font-medium">No se ha guardado. Revisa estos valores:</p>
            <ul className="mt-2 list-disc pl-5">
              {issues.map((issue, i) => (
                <li key={i}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(toDraft(defaults) as Draft);
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

      {section(
        `Leaderboard de ${month}`,
        "Vista previa del mes en curso: puntos ganados viendo y en lluvias (no cuentan juegos, cajas ni sorteos).",
        board === null ? (
          <p className="text-sm text-muted-foreground">No se ha podido cargar.</p>
        ) : board.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay puntos este mes.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="w-16 py-1">Puesto</th>
                <th>Usuario</th>
                <th className="text-right">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {board.map((e) => (
                <tr key={e.position} className="border-t">
                  <td className="py-1">{e.position}</td>
                  <td>{e.username}</td>
                  <td className="text-right">{e.points.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {section(
        "Reinicio mensual",
        "Guarda el top del mes anterior, cierra pujas y sorteos, pone todos los saldos a 0 y concede los bonus del leaderboard. La racha no se toca.",
        <>
          <div className="text-sm">
            {lastReset ? (
              <ul className="space-y-1">
                <li>
                  Último: <b>{lastReset.month}</b> (cierra {lastReset.closed_month})
                  {lastReset.forced ? " · manual" : " · automático"} ·{" "}
                  {lastReset.completed_at ? (
                    <span className="font-medium">completado {fmtDate(lastReset.completed_at)}</span>
                  ) : (
                    <span className="font-medium text-destructive">sin completar</span>
                  )}
                </li>
                <li className="text-muted-foreground">
                  Top guardado: {fmtDate(lastReset.leaderboard_saved_at)} · Subastas cerradas:{" "}
                  {lastReset.auctions_closed ?? "—"} · Sorteos cerrados:{" "}
                  {lastReset.giveaways_closed ?? "—"} · Saldos a 0: {lastReset.users_reset ?? "—"} ·
                  Bonus concedidos: {lastReset.bonus_users ?? "—"}
                </li>
                {lastReset.error && (
                  <li className="text-destructive">Último error: {lastReset.error}</li>
                )}
              </ul>
            ) : (
              <p className="text-muted-foreground">Todavía no se ha hecho ningún reinicio.</p>
            )}
          </div>

          {confirmStep === 0 && (
            <Button type="button" variant="destructive" onClick={() => setConfirmStep(1)}>
              Lanzar reinicio mensual
            </Button>
          )}
          {confirmStep === 1 && (
            <div className="space-y-3 rounded-md border border-destructive/50 p-3">
              <p className="text-sm">
                Esto pone a 0 el saldo de TODOS los usuarios y cierra las pujas y sorteos abiertos.
                No se puede deshacer. ¿Continuar?
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmStep(0)}>
                  Cancelar
                </Button>
                <Button type="button" variant="destructive" onClick={() => setConfirmStep(2)}>
                  Sí, continuar
                </Button>
              </div>
            </div>
          )}
          {confirmStep === 2 && (
            <div className="space-y-3 rounded-md border border-destructive/50 p-3">
              <p className="text-sm">
                Última confirmación: escribe <b>REINICIAR</b> para lanzarlo.
              </p>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConfirmStep(0);
                    setConfirmText("");
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={confirmText !== "REINICIAR" || isResetting}
                  onClick={handleReset}
                >
                  {isResetting ? "Reiniciando..." : "Reiniciar ahora"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
