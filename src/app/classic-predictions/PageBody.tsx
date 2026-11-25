"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AdminClassicPrediction, ClassicTemplate } from "../utils/classicPredictions";
import {
  CLASSIC_DEFAULT_MAX_BET,
  CLASSIC_DEFAULT_MIN_BET,
  CLASSIC_TIMER_MAX_SECONDS,
  CLASSIC_TIMER_MIN_SECONDS,
  type ClassicLockMode,
  type ClassicSide,
} from "../utils/classicPredictions/schema";

type ListData = {
  available: boolean;
  now: number;
  live: boolean;
  templates: ClassicTemplate[];
  items: AdminClassicPrediction[];
};

type ApiResult<T> = { success: boolean; data?: T; error?: string; code?: string };

/** Llama a la API del panel; lanza con el mensaje (ya en español) si falla. */
async function call<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error("Error de conexión");
  }
  const result: ApiResult<T> | null = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.error ?? "Error desconocido");
  return result.data as T;
}

const fmtNumber = (value: number) =>
  value.toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: "always" });

const fmtDate = (seconds: number | null) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("es-ES", {
        timeZone: "Europe/Andorra",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

const fmtCountdown = (seconds: number) => {
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** Cuántas veces se multiplica lo puesto a una opción si gana ("—" si está a 0). */
const multiplier = (pool: number, total: number) =>
  pool > 0 ? `x${(total / pool).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

const percent = (pool: number, total: number) => (total > 0 ? Math.round((pool / total) * 100) : 0);

const peopleText = (count: number) => `${fmtNumber(count)} ${count === 1 ? "persona" : "personas"}`;

const isActive = (p: AdminClassicPrediction) => p.status === "open" || p.status === "locked";

const sideText = (p: AdminClassicPrediction, side: ClassicSide) => (side === "a" ? p.optionA : p.optionB);

const CANCEL_REASONS: Record<string, string> = {
  admin: "Anulada a mano · puntos devueltos",
  monthly_reset: "Anulada por el reinicio mensual · puntos devueltos",
  month_changed: "Anulada: cruzó el cambio de mes · puntos devueltos",
};

const TIMER_SHORTCUTS = [
  { label: "30 s", seconds: 30 },
  { label: "1 min", seconds: 60 },
  { label: "2 min", seconds: 120 },
  { label: "5 min", seconds: 300 },
];

/** Entero positivo escrito en un campo, o null. */
const parseInteger = (raw: string): number | null => {
  const text = raw.trim();
  if (!/^\d{1,12}$/.test(text)) return null;
  return Number(text);
};

type ConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};

export default function PageBody({ initial }: { initial: ListData }) {
  const [data, setData] = useState<ListData>(initial);
  // Reloj del servidor: la hora que dijo en la última lectura y la del navegador en ese momento.
  const [clock, setClock] = useState(() => ({ server: initial.now, client: Date.now() }));
  const [tick, setTick] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [templateForm, setTemplateForm] = useState<{ template: ClassicTemplate | null } | null>(null);
  const failedRef = useRef(false);

  // Formulario de «Abrir una predicción ahora»
  const [title, setTitle] = useState("");
  const [optionA, setOptionA] = useState("");
  const [optionB, setOptionB] = useState("");
  const [lockMode, setLockMode] = useState<ClassicLockMode>("manual");
  const [seconds, setSeconds] = useState("60");
  const [minBet, setMinBet] = useState(String(CLASSIC_DEFAULT_MIN_BET));
  const [maxBet, setMaxBet] = useState(String(CLASSIC_DEFAULT_MAX_BET));

  const active = useMemo(() => data.items.filter(isActive), [data.items]);
  const history = useMemo(() => data.items.filter((p) => !isActive(p)), [data.items]);
  const hasActive = active.length > 0;
  const hasTimer = active.some((p) => p.votable && p.lockMode === "timer");

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true);
    try {
      const next = await call<ListData>("/api/admin/classic-predictions", "GET");
      setData(next);
      setClock({ server: next.now, client: Date.now() });
      failedRef.current = false;
    } catch (error) {
      // Los refrescos automáticos solo avisan una vez seguida.
      if (!silent || !failedRef.current) {
        toast.error(`No se ha podido actualizar: ${error instanceof Error ? error.message : "error"}`);
      }
      failedRef.current = true;
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  // Refresco automático cada ~5 s mientras haya predicciones en marcha y la pestaña se vea.
  useEffect(() => {
    if (!hasActive || !data.available) return;
    const run = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = setInterval(run, 5000);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [hasActive, data.available, load]);

  // Reloj de la cuenta atrás.
  useEffect(() => {
    if (!hasTimer) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasTimer]);

  const serverNow = clock.server + (Math.max(tick, clock.client) - clock.client) / 1000;

  /** Ejecuta una acción, avisa del resultado y recarga. Devuelve si salió bien. */
  const run = async (action: () => Promise<void>, errorMessage: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      await load(true);
      return true;
    } catch (error) {
      toast.error(`${errorMessage}: ${error instanceof Error ? error.message : "error"}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ───────────── predicciones de serie ─────────────

  const saveTemplate = async (
    template: ClassicTemplate | null,
    values: Omit<ClassicTemplate, "id" | "sortOrder">
  ): Promise<boolean> =>
    run(async () => {
      if (template) {
        await call(`/api/admin/classic-predictions/templates/${template.id}`, "PUT", {
          ...values,
          sortOrder: template.sortOrder,
        });
        toast.success("Predicción de serie guardada");
      } else {
        await call("/api/admin/classic-predictions/templates", "POST", values);
        toast.success(
          values.isActive && data.live
            ? "Predicción de serie creada: se abre ahora mismo en este directo"
            : "Predicción de serie creada"
        );
      }
    }, "No se ha guardado");

  const toggleTemplate = (t: ClassicTemplate) =>
    run(async () => {
      await call(`/api/admin/classic-predictions/templates/${t.id}`, "PUT", {
        title: t.title,
        optionA: t.optionA,
        optionB: t.optionB,
        minBet: t.minBet,
        maxBet: t.maxBet,
        isActive: !t.isActive,
        sortOrder: t.sortOrder,
      });
      toast.success(t.isActive ? "Predicción de serie desactivada" : "Predicción de serie activada");
    }, "No se ha cambiado");

  const askDeleteTemplate = (t: ClassicTemplate) =>
    setConfirm({
      title: "Borrar predicción de serie",
      description: `Se borra «${t.title}» y no se abrirá más en los directos. Las que ya se hayan abierto a partir de ella siguen su curso.`,
      confirmLabel: "Borrar",
      destructive: true,
      onConfirm: async () => {
        await call(`/api/admin/classic-predictions/templates/${t.id}`, "DELETE");
        toast.success("Predicción de serie borrada");
      },
    });

  // ───────────── abrir ahora ─────────────

  const create = async () => {
    const min = parseInteger(minBet);
    const max = parseInteger(maxBet);
    if (min === null || max === null || min < 1) return toast.error("Mínimo y máximo deben ser números enteros de puntos.");
    let secs: number | undefined;
    if (lockMode === "timer") {
      const parsed = parseInteger(seconds);
      if (parsed === null || parsed < CLASSIC_TIMER_MIN_SECONDS || parsed > CLASSIC_TIMER_MAX_SECONDS) {
        return toast.error(
          `La votación con temporizador dura entre ${CLASSIC_TIMER_MIN_SECONDS} y ${fmtNumber(CLASSIC_TIMER_MAX_SECONDS)} segundos.`
        );
      }
      secs = parsed;
    }
    const ok = await run(async () => {
      await call("/api/admin/classic-predictions", "POST", {
        title: title.trim(),
        optionA: optionA.trim(),
        optionB: optionB.trim(),
        lockMode,
        ...(secs !== undefined ? { seconds: secs } : {}),
        minBet: min,
        maxBet: max,
      });
      toast.success("Predicción abierta");
    }, "No se ha abierto la predicción");
    if (ok) {
      setTitle("");
      setOptionA("");
      setOptionB("");
    }
  };

  // ───────────── acciones sobre una predicción ─────────────

  const lock = (p: AdminClassicPrediction) =>
    run(async () => {
      await call(`/api/admin/classic-predictions/${p.id}`, "POST", { action: "lock" });
      toast.success("Votación cerrada");
    }, "No se ha cerrado la votación");

  const askResolve = (p: AdminClassicPrediction, side: ClassicSide) => {
    const total = p.poolA + p.poolB;
    const winnerPool = side === "a" ? p.poolA : p.poolB;
    const winnerPeople = side === "a" ? p.bettorsA : p.bettorsB;
    const everyone = p.bettorsA + p.bettorsB;
    const name = sideText(p, side);
    let description: string;
    if (winnerPool <= 0) {
      description =
        total > 0
          ? `Nadie eligió «${name}»: se devolverán los ${fmtNumber(total)} puntos puestos a ${peopleText(everyone)} y la predicción quedará sin ganadores.`
          : `Nadie ha puesto puntos en esta predicción: quedará resuelta sin repartir nada.`;
    } else {
      description = `Se repartirán ${fmtNumber(total)} puntos entre ${peopleText(winnerPeople)} que eligieron «${name}» (a ${multiplier(winnerPool, total)} lo puesto, redondeado hacia abajo en cada persona).`;
    }
    if (p.status === "open" && p.votable) description += " La votación se cierra con esto.";
    description += " No se puede cambiar después.";
    setConfirm({
      title: `Gana ${side.toUpperCase()}: ${name}`,
      description,
      confirmLabel: "Dar el resultado",
      onConfirm: async () => {
        const result = await call<{ paid: number; winners: number; refunded: boolean; cancelled: boolean }>(
          `/api/admin/classic-predictions/${p.id}`,
          "POST",
          { action: "resolve", winner: side }
        );
        if (result.cancelled) {
          toast.warning("La predicción cruzó el cambio de mes: se ha anulado y se han devuelto los puntos.");
        } else if (result.refunded) {
          toast.info("Nadie había elegido esa opción: se han devuelto todos los puntos.");
        } else {
          toast.success(`Resultado guardado: ${fmtNumber(result.paid)} puntos repartidos entre ${peopleText(result.winners)}.`);
        }
      },
    });
  };

  const askCancel = (p: AdminClassicPrediction) => {
    const total = p.poolA + p.poolB;
    const people = p.bettorsA + p.bettorsB;
    setConfirm({
      title: "Anular y devolver puntos",
      description:
        total > 0
          ? `Se anula «${p.title}» y se devuelven los ${fmtNumber(total)} puntos a ${peopleText(people)}. No se puede deshacer.`
          : `Se anula «${p.title}». Nadie ha puesto puntos todavía. No se puede deshacer.`,
      confirmLabel: "Anular",
      destructive: true,
      onConfirm: async () => {
        const result = await call<{ refunded: number }>(`/api/admin/classic-predictions/${p.id}`, "POST", {
          action: "cancel",
        });
        toast.success(
          result.refunded > 0
            ? `Predicción anulada: puntos devueltos a ${peopleText(result.refunded)}.`
            : "Predicción anulada."
        );
      },
    });
  };

  // ───────────── pintado ─────────────

  const statusText = (p: AdminClassicPrediction): { text: string; className: string } => {
    if (p.status === "open" && p.votable) {
      if (p.lockMode === "timer" && p.locksAt !== null) {
        return {
          text: `Votación abierta · quedan ${fmtCountdown(p.locksAt - serverNow)}`,
          className: "text-green-300 bg-green-500/20",
        };
      }
      const how = p.lockMode === "stream" ? " · hasta que acabe el directo" : "";
      return { text: `Votación abierta${how}`, className: "text-green-300 bg-green-500/20" };
    }
    return { text: "Votación cerrada · esperando resultado", className: "text-amber-300 bg-amber-500/20" };
  };

  const lockModeText = (p: AdminClassicPrediction) =>
    p.lockMode === "manual" ? "Se cierra a mano" : p.lockMode === "timer" ? "Con temporizador" : "Hasta que acabe el directo";

  const liveBadge = data.live ? (
    <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs font-medium text-green-300">Directo en marcha</span>
  ) : (
    <span className="rounded-full bg-zinc-500/20 px-2 py-1 text-xs font-medium text-zinc-300">Sin directo</span>
  );

  const refreshButton = (
    <Button variant="outline" size="sm" disabled={refreshing} onClick={() => load(false)}>
      <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      Refrescar
    </Button>
  );

  if (!data.available) {
    return (
      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium">Falta aplicar la migración 0042 en Supabase.</p>
        <p className="mt-1 text-muted-foreground">
          Ejecuta <code>migrations/0042_classic_predictions.sql</code> en el editor SQL de Supabase y recarga esta
          página. Hasta entonces las predicciones (Classic) no existen para nadie.
        </p>
      </div>
    );
  }

  const formInvalid =
    title.trim().length < 3 ||
    !optionA.trim() ||
    !optionB.trim() ||
    (lockMode === "stream" && !data.live);

  return (
    <div className="w-full space-y-6 py-4">
      {/* Estado */}
      <div className="flex flex-wrap items-center gap-3">
        {liveBadge}
        <span className="text-sm text-muted-foreground">
          Aquí la gente juega puntos a una de las dos opciones desde la extensión, y el bote entero se reparte entre
          quienes aciertan, en proporción a lo que puso cada uno. El resultado lo das siempre tú a mano.
        </span>
        <div className="ml-auto">{refreshButton}</div>
      </div>

      {/* Predicciones de serie */}
      <div className="rounded-md border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Predicciones de serie</p>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Se abren solas en cada directo y la votación dura todo el directo: se cierra sola cuando acaba. El
              resultado lo das tú a mano. Cada una se abre una sola vez por día de directo (aunque la resuelvas o la
              anules, no vuelve a salir ese día) y, si activas una con el directo ya en marcha, se abre en ese mismo
              directo.
            </p>
          </div>
          <Button size="sm" disabled={busy} onClick={() => setTemplateForm({ template: null })}>
            <Plus className="mr-1 h-4 w-4" />
            Nueva predicción de serie
          </Button>
        </div>

        <div className="mt-3 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead>Opciones</TableHead>
                <TableHead>Puntos por persona</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.templates.length ? (
                data.templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[300px] whitespace-normal font-medium">{t.title}</TableCell>
                    <TableCell className="whitespace-normal">
                      A: {t.optionA} · B: {t.optionB}
                    </TableCell>
                    <TableCell>
                      {fmtNumber(t.minBet)} – {fmtNumber(t.maxBet)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          t.isActive ? "bg-green-500/20 text-green-300" : "bg-zinc-500/20 text-zinc-300"
                        }`}
                      >
                        {t.isActive ? "Activa" : "Desactivada"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleTemplate(t)}>
                          {t.isActive ? "Desactivar" : "Activar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setTemplateForm({ template: t })}
                        >
                          <Pencil className="mr-1 h-4 w-4" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Borrar ${t.title}`}
                          onClick={() => askDeleteTemplate(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    Todavía no hay predicciones de serie.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Abrir ahora */}
      <div className="rounded-md border p-4">
        <p className="mb-3 text-sm font-medium">Abrir una predicción ahora</p>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cp-title">Pregunta</Label>
            <Input
              id="cp-title"
              maxLength={200}
              placeholder="¿Entra el bonus en esta tirada?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cp-a">Opción A</Label>
              <Input
                id="cp-a"
                maxLength={40}
                className="w-56"
                placeholder="Sí"
                value={optionA}
                onChange={(e) => setOptionA(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-b">Opción B</Label>
              <Input
                id="cp-b"
                maxLength={40}
                className="w-56"
                placeholder="No"
                value={optionB}
                onChange={(e) => setOptionB(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Cómo se cierra la votación</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={lockMode === "manual" ? "default" : "outline"}
                onClick={() => setLockMode("manual")}
              >
                A mano
              </Button>
              <Button
                type="button"
                size="sm"
                variant={lockMode === "timer" ? "default" : "outline"}
                onClick={() => setLockMode("timer")}
              >
                Temporizador
              </Button>
              <Button
                type="button"
                size="sm"
                variant={lockMode === "stream" ? "default" : "outline"}
                disabled={!data.live}
                onClick={() => setLockMode("stream")}
              >
                Hasta que acabe el directo
              </Button>
            </div>
            {!data.live && (
              <p className="text-xs text-muted-foreground">
                «Hasta que acabe el directo» solo se puede elegir con el directo encendido.
              </p>
            )}
            {lockMode === "stream" && !data.live && (
              <p className="text-xs text-amber-300">El directo ya no está en marcha: elige otra forma de cerrarla.</p>
            )}
          </div>

          {lockMode === "timer" && (
            <div className="grid gap-1.5">
              <Label htmlFor="cp-seconds">Duración de la votación</Label>
              <div className="flex flex-wrap items-center gap-2">
                {TIMER_SHORTCUTS.map((shortcut) => (
                  <Button
                    key={shortcut.seconds}
                    type="button"
                    size="sm"
                    variant={seconds === String(shortcut.seconds) ? "default" : "outline"}
                    onClick={() => setSeconds(String(shortcut.seconds))}
                  >
                    {shortcut.label}
                  </Button>
                ))}
                <Input
                  id="cp-seconds"
                  type="number"
                  min={CLASSIC_TIMER_MIN_SECONDS}
                  max={CLASSIC_TIMER_MAX_SECONDS}
                  className="w-28"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">segundos</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Entre {CLASSIC_TIMER_MIN_SECONDS} segundos y 24 horas. Cuando acabe el tiempo la votación se cierra y
                queda esperando tu resultado.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cp-min">Mínimo de puntos por persona</Label>
              <Input
                id="cp-min"
                type="number"
                min={1}
                className="w-44"
                value={minBet}
                onChange={(e) => setMinBet(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-max">Máximo de puntos por persona</Label>
              <Input
                id="cp-max"
                type="number"
                min={1}
                className="w-44"
                value={maxBet}
                onChange={(e) => setMaxBet(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Button disabled={busy || formInvalid} onClick={create}>
              Abrir predicción
            </Button>
          </div>
        </div>
      </div>

      {/* En marcha */}
      <div className="space-y-3">
        <p className="text-sm font-medium">En marcha</p>
        {active.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {active.map((p) => {
              const total = p.poolA + p.poolB;
              const status = statusText(p);
              return (
                <div key={p.id} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">{p.title}</p>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>{status.text}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.fromTemplate ? "De serie" : `Abierta por ${p.createdBy ?? "el panel"}`} · {lockModeText(p)} ·{" "}
                    {fmtNumber(p.minBet)} – {fmtNumber(p.maxBet)} puntos por persona · {fmtDate(p.createdAt)}
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(["a", "b"] as const).map((side) => {
                      const pool = side === "a" ? p.poolA : p.poolB;
                      const people = side === "a" ? p.bettorsA : p.bettorsB;
                      const pct = percent(pool, total);
                      return (
                        <div key={side} className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Opción {side.toUpperCase()}</p>
                          <p className="font-medium">{sideText(p, side)}</p>
                          <p className="mt-2 text-lg font-semibold">{fmtNumber(pool)} puntos</p>
                          <p className="text-xs text-muted-foreground">
                            {peopleText(people)} · {pct} % del bote
                          </p>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="mt-2 text-sm">
                            Multiplicador: <span className="font-medium">{multiplier(pool, total)}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bote total: {fmtNumber(total)} puntos · {peopleText(p.bettorsA + p.bettorsB)}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.votable && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => lock(p)}>
                        Cerrar votación
                      </Button>
                    )}
                    <Button size="sm" disabled={busy} onClick={() => askResolve(p, "a")}>
                      Gana A: {p.optionA}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => askResolve(p, "b")}>
                      Gana B: {p.optionB}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => askCancel(p)}>
                      Anular y devolver puntos
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            No hay ninguna predicción en marcha.
          </div>
        )}
        {hasActive && (
          <p className="text-xs text-muted-foreground">Se actualiza sola cada pocos segundos mientras tengas esta pestaña a la vista.</p>
        )}
      </div>

      {/* Historial */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Historial</p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Bote</TableHead>
                <TableHead>Repartido</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length ? (
                history.map((p) => {
                  const total = p.poolA + p.poolB;
                  let result: string;
                  if (p.status === "resolved") {
                    const name = p.winner ? `${p.winner.toUpperCase()}: ${sideText(p, p.winner)}` : "-";
                    result = p.refunded
                      ? `Ganaba ${name}, pero nadie la eligió · se devolvió todo`
                      : `Ganó ${name}`;
                  } else {
                    result = CANCEL_REASONS[p.cancelReason ?? ""] ?? "Anulada · puntos devueltos";
                  }
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[280px] whitespace-normal font-medium">
                        {p.title}
                        <span className="block text-xs font-normal text-muted-foreground">
                          A: {p.optionA} · B: {p.optionB} · {p.fromTemplate ? "De serie" : (p.createdBy ?? "Panel")}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[260px] whitespace-normal">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            p.status === "resolved" && !p.refunded
                              ? "bg-sky-500/20 text-sky-300"
                              : "bg-zinc-500/20 text-zinc-300"
                          }`}
                        >
                          {result}
                        </span>
                      </TableCell>
                      <TableCell>
                        {fmtNumber(total)} puntos
                        <span className="block text-xs text-muted-foreground">
                          A: {fmtNumber(p.poolA)} ({p.bettorsA}) · B: {fmtNumber(p.poolB)} ({p.bettorsB})
                        </span>
                      </TableCell>
                      <TableCell>
                        {p.status === "resolved" && !p.refunded
                          ? `${fmtNumber(p.paidTotal)} puntos`
                          : p.refunded
                            ? `${fmtNumber(total)} puntos devueltos`
                            : "-"}
                      </TableCell>
                      <TableCell>{fmtDate(p.status === "resolved" ? p.resolvedAt : p.cancelledAt)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Todavía no hay predicciones terminadas.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {templateForm && (
        <TemplateDialog
          key={templateForm.template?.id ?? "new"}
          template={templateForm.template}
          busy={busy}
          live={data.live}
          onClose={() => setTemplateForm(null)}
          onSave={async (values) => {
            if (await saveTemplate(templateForm.template, values)) setTemplateForm(null);
          }}
        />
      )}

      {confirm && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription>{confirm.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button
                variant={confirm.destructive ? "destructive" : "default"}
                disabled={busy}
                onClick={async () => {
                  const current = confirm;
                  const ok = await run(current.onConfirm, "No se ha podido hacer");
                  if (ok) setConfirm(null);
                }}
              >
                {confirm.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  busy,
  live,
  onClose,
  onSave,
}: {
  template: ClassicTemplate | null;
  busy: boolean;
  live: boolean;
  onClose: () => void;
  onSave: (values: Omit<ClassicTemplate, "id" | "sortOrder">) => Promise<void>;
}) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [optionA, setOptionA] = useState(template?.optionA ?? "");
  const [optionB, setOptionB] = useState(template?.optionB ?? "");
  const [minBet, setMinBet] = useState(String(template?.minBet ?? CLASSIC_DEFAULT_MIN_BET));
  const [maxBet, setMaxBet] = useState(String(template?.maxBet ?? CLASSIC_DEFAULT_MAX_BET));
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  const submit = () => {
    const min = parseInteger(minBet);
    const max = parseInteger(maxBet);
    if (min === null || max === null || min < 1) {
      return toast.error("Mínimo y máximo deben ser números enteros de puntos.");
    }
    return onSave({ title: title.trim(), optionA: optionA.trim(), optionB: optionB.trim(), minBet: min, maxBet: max, isActive });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? "Editar predicción de serie" : "Nueva predicción de serie"}</DialogTitle>
          <DialogDescription>
            Se abrirá sola en cada directo mientras esté activa. Los cambios solo afectan a las que se abran a partir
            de ahora.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ct-title">Pregunta</Label>
            <Input id="ct-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ct-a">Opción A</Label>
              <Input id="ct-a" maxLength={40} className="w-48" value={optionA} onChange={(e) => setOptionA(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ct-b">Opción B</Label>
              <Input id="ct-b" maxLength={40} className="w-48" value={optionB} onChange={(e) => setOptionB(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ct-min">Mínimo de puntos</Label>
              <Input id="ct-min" type="number" min={1} className="w-40" value={minBet} onChange={(e) => setMinBet(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ct-max">Máximo de puntos</Label>
              <Input id="ct-max" type="number" min={1} className="w-40" value={maxBet} onChange={(e) => setMaxBet(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Activa
          </label>
          {isActive && live && (
            <p className="text-xs text-amber-300">
              Hay un directo en marcha: si todavía no se ha abierto hoy, se abrirá ahora mismo en este directo.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || title.trim().length < 3 || !optionA.trim() || !optionB.trim()} onClick={submit}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
