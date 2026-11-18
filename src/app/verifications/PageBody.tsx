"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AdminVerificationRequest, VerificationStatus } from "@/app/utils/verification";
import type { CasinoFunnelRow } from "@/app/utils/verification/stats";

const TABS: Array<{ key: VerificationStatus; label: string }> = [
  { key: "pending", label: "Pendientes" },
  { key: "approved", label: "Aprobadas" },
  { key: "rejected", label: "Rechazadas" },
  { key: "revoked", label: "Retiradas" },
];

const PROOFS: Array<{ kind: "welcome" | "deposit"; label: string }> = [
  { kind: "welcome", label: "Correo de bienvenida" },
  { kind: "deposit", label: "Depósito" },
];

const formatDate = (seconds: number | null) =>
  seconds ? new Date(seconds * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

const proofUrl = (id: number, kind: string) => `/api/admin/verifications/${id}/proof?kind=${kind}`;

export default function PageBody({
  requests,
  unavailable,
  funnel,
}: {
  requests: AdminVerificationRequest[];
  unavailable: string | null;
  funnel: CasinoFunnelRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<VerificationStatus>("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);

  const counts = useMemo(() => {
    const c: Record<VerificationStatus, number> = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
    for (const r of requests) c[r.status] += 1;
    return c;
  }, [requests]);
  const shown = requests.filter((r) => r.status === tab);

  const send = async (request: AdminVerificationRequest, body: Record<string, unknown>, done: string) => {
    setBusyId(request.id);
    try {
      const response = await fetch(`/api/admin/verifications/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(result?.message ?? "No se pudo resolver la solicitud");
        return;
      }
      toast.success(done);
      router.refresh();
    } catch (error) {
      console.error("Error reviewing verification:", error);
      toast.error("Error de conexión");
    } finally {
      setBusyId(null);
    }
  };

  const approve = (request: AdminVerificationRequest) => {
    const ok = window.confirm(
      `¿Has comprobado en el panel de Betandeal que «${request.casino_username}» está en ${request.casino} y que el depósito es de 30 € o más?\n\n` +
        `Al aprobar, ${request.username ?? "este usuario"} queda verificado en ese casino y se borran las dos capturas.`
    );
    if (ok) void send(request, { approve: true }, "Verificación aprobada");
  };

  const reject = (request: AdminVerificationRequest) => {
    const text = window.prompt("Motivo del rechazo (se le enseña al usuario, que puede volver a enviarla):", "");
    if (text === null) return;
    if (!text.trim()) {
      toast.error("Escribe el motivo del rechazo");
      return;
    }
    void send(request, { approve: false, note: text.trim() }, "Solicitud rechazada");
  };

  const revoke = (request: AdminVerificationRequest) => {
    const ok = window.confirm(
      `¿Retirar la verificación de ${request.username ?? "este usuario"} en ${request.casino}? Ese casino deja de contar para sus puntos VIP.`
    );
    if (ok) void send(request, { revoke: true }, "Verificación retirada");
  };

  const funnelTable = funnel.length > 0 && (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">Por casino</h2>
      <p className="text-sm text-muted-foreground">
        Clics en «Conseguir bono», solicitudes de verificación enviadas y aprobadas, desde el principio.
        Los clics solo guardan el número, no quién hace clic.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Casino</th>
              <th className="p-3 text-right">Clics en el bono</th>
              <th className="p-3 text-right">Solicitudes enviadas</th>
              <th className="p-3 text-right">Aprobadas</th>
            </tr>
          </thead>
          <tbody>
            {funnel.map((row) => (
              <tr key={row.casino} className="border-b last:border-0">
                <td className="p-3 font-medium">{row.casino}</td>
                <td className="p-3 text-right tabular-nums">
                  {row.clicks === null ? "—" : row.clicks.toLocaleString("es-ES")}
                </td>
                <td className="p-3 text-right tabular-nums">{row.requests.toLocaleString("es-ES")}</td>
                <td className="p-3 text-right tabular-nums">{row.approved.toLocaleString("es-ES")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {funnel.some((row) => row.clicks === null) && (
        <p className="text-xs text-muted-foreground">
          Para contar los clics falta aplicar la migración 0033 en Supabase.
        </p>
      )}
    </div>
  );

  if (unavailable) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm">
          {unavailable}. Hasta entonces los usuarios no pueden enviar solicitudes.
        </div>
        {funnelTable}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        <p>
          Cada solicitud trae el casino, el usuario de ese casino y dos capturas: el correo de bienvenida y
          el primer depósito (30 € o más, con importe, fecha y hora).
        </p>
        <p className="mt-1 font-medium text-foreground">
          Antes de aprobar, comprueba el usuario en el panel de Betandeal.
        </p>
        <p className="mt-1">
          Al aprobar o rechazar se borran las dos capturas: solo queda guardado el casino, el usuario del
          casino, el estado y la fecha. Cada casino aprobado sube el tramo de puntos VIP de la cuenta
          (1 casino, 2, o 3 o más).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>
            {t.label} ({counts[t.key]})
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No hay solicitudes en este estado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Usuario</th>
                <th className="p-3">Kick / Twitch</th>
                <th className="p-3">Casino</th>
                <th className="p-3">Usuario en el casino</th>
                {tab === "pending" && <th className="p-3">Capturas</th>}
                <th className="p-3">Enviada</th>
                <th className="p-3">{tab === "pending" ? "Acciones" : "Resuelta"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{r.username ?? `#${r.user_id}`}</div>
                    <div className="text-xs text-muted-foreground">{r.email ?? ""}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.verified_casinos > 0
                        ? `Ya verificado en ${r.verified_casinos} ${r.verified_casinos === 1 ? "casino" : "casinos"}`
                        : "Sin verificar"}
                    </div>
                    {r.repeated_proofs.length > 0 && (
                      <div className="mt-1.5 rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300">
                        Captura repetida: la misma imagen la subió{" "}
                        {r.repeated_proofs
                          .map((p) => `${p.username ?? `#${p.user_id}`} (solicitud #${p.request_id}, ${p.casino})`)
                          .join(", ")}
                        .
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {r.kick_username ?? "—"} / {r.twitch_username ?? "—"}
                  </td>
                  <td className="p-3">{r.casino}</td>
                  <td className="p-3 font-mono">{r.casino_username}</td>
                  {tab === "pending" && (
                    <td className="p-3">
                      {r.has_proofs ? (
                        <div className="flex gap-2">
                          {PROOFS.map((proof) => (
                            <button
                              key={proof.kind}
                              type="button"
                              title={`Ampliar: ${proof.label}`}
                              onClick={() => setZoom({ src: proofUrl(r.id, proof.kind), label: `${proof.label} · ${r.casino} · ${r.casino_username}` })}
                              className="block cursor-zoom-in text-center"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={proofUrl(r.id, proof.kind)}
                                alt={proof.label}
                                className="h-24 w-32 rounded border bg-muted object-cover"
                              />
                              <span className="mt-1 block text-xs text-muted-foreground">{proof.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin capturas</span>
                      )}
                    </td>
                  )}
                  <td className="p-3 text-xs">{formatDate(r.created_at)}</td>
                  <td className="p-3">
                    {tab === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busyId === r.id} onClick={() => approve(r)}>
                          Aprobar
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => reject(r)}>
                          Rechazar
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2 text-xs">
                        <div>
                          {formatDate(r.reviewed_at)} · {r.reviewed_by ?? "—"}
                          {r.note && <div className="text-muted-foreground">Motivo: {r.note}</div>}
                        </div>
                        {tab === "approved" && (
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => revoke(r)}>
                            Retirar verificación
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {funnelTable}

      {zoom && (
        <div
          role="dialog"
          aria-label={zoom.label}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.src} alt={zoom.label} className="max-h-[85vh] max-w-full rounded bg-white object-contain" />
          <p className="text-sm text-white">{zoom.label} · pulsa para cerrar</p>
        </div>
      )}
    </div>
  );
}
