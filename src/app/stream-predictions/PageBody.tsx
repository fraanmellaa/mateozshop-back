"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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

import type { AdminStreamPrediction } from "../utils/streamPredictions";
import {
  MAX_OPTIONS,
  type StreamPredictionKind,
  type StreamPredictionSettings,
} from "../utils/streamPredictions/schema";

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "Error desconocido");
  return result;
}

const fmtDate = (seconds: number | null) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("es-ES", {
        timeZone: "Europe/Andorra",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

// Con punto de millar también en los números de cuatro cifras (2.500).
const fmtNumber = (value: number) =>
  value.toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: "always" });

/** "1.234,5" o "1234.5" -> 1234.5; null si no es un número. */
function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const STATUS: Record<AdminStreamPrediction["status"], { text: string; className: string }> = {
  open: { text: "Votación abierta", className: "text-green-300 bg-green-500/20" },
  closed: { text: "Votación cerrada", className: "text-amber-300 bg-amber-500/20" },
  resolved: { text: "Con resultado", className: "text-sky-300 bg-sky-500/20" },
  cancelled: { text: "Anulada", className: "text-zinc-300 bg-zinc-500/20" },
};

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export default function PageBody({
  available,
  predictions,
  settings,
}: {
  /** false mientras no esté aplicada la migración 0038. */
  available: boolean;
  predictions: AdminStreamPrediction[];
  settings: StreamPredictionSettings;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Ajustes
  const [winnerPoints, setWinnerPoints] = useState(String(settings.winnerPoints));
  const [maxPerStream, setMaxPerStream] = useState(String(settings.maxPerStream));

  // Nueva predicción
  const [question, setQuestion] = useState("");
  const [kind, setKind] = useState<StreamPredictionKind>("options");
  const [options, setOptions] = useState<string[]>(["Sí", "No"]);

  // Resultado que se está escribiendo, por predicción
  const [results, setResults] = useState<Record<number, string>>({});

  const run = async (action: () => Promise<unknown>, errorMessage: string, done?: () => void) => {
    setBusy(true);
    try {
      await action();
      done?.();
      router.refresh();
    } catch (error) {
      alert(`${errorMessage}: ${error instanceof Error ? error.message : "error"}`);
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = () =>
    run(
      () =>
        send("/api/admin/stream-predictions/settings", "PUT", {
          winnerPoints: Number(winnerPoints),
          maxPerStream: Number(maxPerStream),
        }),
      "No se han guardado los ajustes"
    );

  const create = () =>
    run(
      () =>
        send("/api/admin/stream-predictions", "POST", {
          question,
          kind,
          ...(kind === "options" ? { options: options.map((o) => o.trim()).filter(Boolean) } : {}),
        }),
      "No se ha abierto la predicción",
      () => setQuestion("")
    );

  const act = (p: AdminStreamPrediction, body: Record<string, unknown>, errorMessage: string) =>
    run(() => send(`/api/admin/stream-predictions/${p.id}`, "POST", body), errorMessage);

  const resolve = (p: AdminStreamPrediction) => {
    const raw = results[p.id] ?? "";
    let body: Record<string, unknown>;
    let shown: string;
    if (p.kind === "options") {
      if (raw === "") return alert("Elige la opción correcta.");
      body = { action: "resolve", option: Number(raw) };
      shown = p.options[Number(raw)];
    } else {
      const value = parseNumber(raw);
      if (value === null) return alert("Escribe el número del resultado.");
      body = { action: "resolve", number: value };
      shown = fmtNumber(value);
    }
    if (
      !confirm(
        `Resultado: "${shown}". Se elige al ganador y se le pagan ${fmtNumber(p.winnerPoints)} puntos. No se puede cambiar después. ¿Seguir?`
      )
    ) {
      return;
    }
    return act(p, body, "No se ha guardado el resultado");
  };

  const cancel = (p: AdminStreamPrediction) => {
    if (!confirm(`¿Anular "${p.question}"? No se paga a nadie y no cuenta para el máximo del directo.`)) return;
    return act(p, { action: "cancel" }, "No se ha anulado");
  };

  if (!available) {
    return (
      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium">Falta aplicar la migración 0038 en Supabase.</p>
        <p className="mt-1 text-muted-foreground">
          Ejecuta <code>migrations/0038_stream_predictions.sql</code> en el editor SQL de Supabase y
          recarga esta página. Hasta entonces las predicciones no existen para nadie.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 py-4">
      <p className="text-sm text-muted-foreground">
        Participar es gratis y se vota desde la extensión, una vez por persona. Gana una sola persona:
        quien acierta o quien más se acerca; si hay empate, quien votó primero. Pasos: abre la
        predicción con el directo encendido, cierra la votación antes de que se vea el resultado y,
        cuando se sepa, pon el resultado.
      </p>

      {/* Ajustes */}
      <div className="rounded-md border p-4">
        <p className="mb-3 text-sm font-medium">Ajustes</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-points">Puntos para el ganador</Label>
            <Input
              id="sp-points"
              type="number"
              min={1}
              max={1000000}
              className="w-40"
              value={winnerPoints}
              onChange={(e) => setWinnerPoints(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-max">Máximo por directo</Label>
            <Input
              id="sp-max"
              type="number"
              min={0}
              max={20}
              className="w-40"
              value={maxPerStream}
              onChange={(e) => setMaxPerStream(e.target.value)}
            />
          </div>
          <Button variant="outline" disabled={busy} onClick={saveSettings}>
            Guardar ajustes
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          El importe se fija al abrir cada predicción: cambiarlo aquí solo afecta a las siguientes.
        </p>
      </div>

      {/* Nueva predicción */}
      <div className="rounded-md border p-4">
        <p className="mb-3 text-sm font-medium">Nueva predicción</p>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-question">Pregunta</Label>
            <Input
              id="sp-question"
              maxLength={200}
              placeholder="¿En cuánto acaba el bonus hunt?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-kind">Tipo</Label>
            <select
              id="sp-kind"
              className={`${selectClass} w-72`}
              value={kind}
              onChange={(e) => setKind(e.target.value as StreamPredictionKind)}
            >
              <option value="options">Opciones (gana quien acierta)</option>
              <option value="number">Número (gana quien más se acerca)</option>
            </select>
          </div>
          {kind === "options" && (
            <div className="grid gap-1.5">
              <Label>Opciones</Label>
              <div className="flex flex-wrap items-center gap-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <Input
                      aria-label={`Opción ${index + 1}`}
                      maxLength={60}
                      className="w-44"
                      value={option}
                      onChange={(e) =>
                        setOptions((current) => current.map((o, i) => (i === index ? e.target.value : o)))
                      }
                    />
                    {options.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar la opción ${index + 1}`}
                        onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {options.length < MAX_OPTIONS && (
                  <Button variant="outline" size="sm" onClick={() => setOptions((current) => [...current, ""])}>
                    <Plus className="mr-1 h-4 w-4" />
                    Añadir opción
                  </Button>
                )}
              </div>
            </div>
          )}
          <div>
            <Button disabled={busy || question.trim().length < 3} onClick={create}>
              Abrir predicción
            </Button>
          </div>
        </div>
      </div>

      {/* Listado */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pregunta</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Votos</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Ganador</TableHead>
              <TableHead>Abierta</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {predictions.length ? (
              predictions.map((p) => {
                const status = STATUS[p.status];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[280px] whitespace-normal font-medium">
                      {p.question}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {p.kind === "options" ? p.options.join(" · ") : "Número"} · {fmtNumber(p.winnerPoints)} puntos
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>
                        {status.text}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.votes}
                      {p.optionVotes && (
                        <span className="block text-xs text-muted-foreground">
                          {p.options.map((option, i) => `${option}: ${p.optionVotes?.[i] ?? 0}`).join(" · ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.status !== "resolved"
                        ? "-"
                        : p.kind === "options"
                          ? (p.options[p.resultOption ?? -1] ?? "-")
                          : p.resultNumber === null
                            ? "-"
                            : fmtNumber(p.resultNumber)}
                    </TableCell>
                    <TableCell>
                      {p.status !== "resolved" ? (
                        "-"
                      ) : p.winner ? (
                        <>
                          {p.winner.username ?? `Usuario ${p.winner.id}`}
                          <span className="block text-xs text-muted-foreground">
                            {p.winner.number !== null ? `Votó ${fmtNumber(p.winner.number)} · ` : ""}
                            {fmtNumber(p.paidPoints)} puntos
                          </span>
                        </>
                      ) : (
                        "Sin ganador"
                      )}
                    </TableCell>
                    <TableCell>{fmtDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {p.status === "open" && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => act(p, { action: "close" }, "No se ha cerrado la votación")}
                          >
                            Cerrar votación
                          </Button>
                        )}
                        {p.status === "closed" && (
                          <>
                            {p.kind === "options" ? (
                              <select
                                aria-label="Opción correcta"
                                className={selectClass}
                                value={results[p.id] ?? ""}
                                onChange={(e) => setResults((current) => ({ ...current, [p.id]: e.target.value }))}
                              >
                                <option value="" disabled>
                                  Opción correcta
                                </option>
                                {p.options.map((option, i) => (
                                  <option key={i} value={i}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                aria-label="Número del resultado"
                                inputMode="decimal"
                                placeholder="Resultado"
                                className="w-32"
                                value={results[p.id] ?? ""}
                                onChange={(e) => setResults((current) => ({ ...current, [p.id]: e.target.value }))}
                              />
                            )}
                            <Button size="sm" disabled={busy} onClick={() => resolve(p)}>
                              Poner resultado
                            </Button>
                          </>
                        )}
                        {(p.status === "open" || p.status === "closed") && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => cancel(p)}>
                            Anular
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Todavía no hay predicciones.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
