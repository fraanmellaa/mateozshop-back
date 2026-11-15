"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, RefreshCw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ConnectionStatus } from "@/app/utils/live/connections";

const NAMES = { kick: "Kick", twitch: "Twitch" } as const;

const EVENT_LABELS: Record<string, string> = {
  "chat.message.sent": "Mensajes del chat",
  "livestream.status.updated": "Estado del directo",
  "channel.chat.message": "Mensajes del chat",
  "stream.online": "Directo iniciado",
  "stream.offline": "Directo terminado",
};

const RETURN_ERRORS: Record<string, string> = {
  AUTHORIZATION_DENIED: "Se canceló la autorización o la plataforma la rechazó.",
  INVALID_STATE: "La autorización caducó (10 min). Vuelve a empezar.",
  OAUTH_FAILED: "La plataforma no aceptó el código. Revisa las credenciales y la URL de redirección.",
  WRONG_ACCOUNT:
    "La cuenta autorizada no es la del canal configurado (KICK_BROADCASTER_USER_ID / TWITCH_BROADCASTER_ID).",
  INTERNAL_SERVER_ERROR: "Error interno al guardar la conexión.",
};

function formatDate(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleString("es-ES") : "—";
}

export default function PageBody({
  connections,
  returnedError,
  returnedConnected,
}: {
  connections: ConnectionStatus[];
  returnedError?: string | null;
  returnedConnected?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (key: string, url: string, method: "POST" | "DELETE", okMessage: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, { method });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "ERROR");
      toast.success(okMessage);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("No se ha podido completar la acción");
    } finally {
      setBusy(null);
    }
  };

  let banner: { kind: "ok" | "error"; text: string } | null = null;
  if (returnedConnected) {
    banner = { kind: "ok", text: `${NAMES[returnedConnected as keyof typeof NAMES] ?? returnedConnected} conectado.` };
  } else if (returnedError) {
    banner = returnedError.startsWith("MISSING_ENV:")
      ? { kind: "error", text: `Faltan variables de entorno: ${returnedError.slice(12)}` }
      : { kind: "error", text: RETURN_ERRORS[returnedError] ?? "No se pudo conectar." };
  }

  return (
    <div className="mx-auto mt-4 max-w-4xl space-y-6">
      <p className="text-sm text-muted-foreground">
        El streamer autoriza la aplicación una vez en cada plataforma. Con eso el back se suscribe a los
        mensajes del chat y al estado del directo (webhooks). Sin esta conexión no se leen los chats y nadie
        gana puntos viendo.
      </p>

      {banner && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            banner.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {banner.text}
        </div>
      )}

      {connections.map((c) => {
        const name = NAMES[c.platform];
        const failing = c.subscriptions.filter((s) => s.status === "error").length;
        const allActive = c.connected && c.subscriptions.length > 0 && failing === 0;

        return (
          <section key={c.platform} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">{name}</h2>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    !c.connected
                      ? "bg-zinc-500/15 text-zinc-300"
                      : allActive
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {!c.connected ? "Sin conectar" : allActive ? "Activa" : "Con problemas"}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {c.missing_env.length === 0 ? (
                  <Button asChild variant={c.connected ? "outline" : "default"}>
                    <a href={`/api/admin/connections/${c.platform}/start`}>
                      <Link2 className="mr-2 h-4 w-4" />
                      {c.connected ? `Reconectar ${name}` : `Conectar ${name}`}
                    </a>
                  </Button>
                ) : (
                  <Button disabled>
                    <Link2 className="mr-2 h-4 w-4" />
                    Conectar {name}
                  </Button>
                )}
                {c.connected && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        call(
                          `${c.platform}-retry`,
                          `/api/admin/connections/${c.platform}/retry`,
                          "POST",
                          "Suscripciones comprobadas"
                        )
                      }
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {busy === `${c.platform}-retry` ? "Reintentando..." : "Reintentar suscripciones"}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Desconectar ${name}? Se borran los tokens y las suscripciones: dejará de leerse su chat.`
                          )
                        ) {
                          void call(
                            `${c.platform}-del`,
                            `/api/admin/connections/${c.platform}`,
                            "DELETE",
                            `${name} desconectado`
                          );
                        }
                      }}
                    >
                      <Unplug className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  </>
                )}
              </div>
            </div>

            {c.missing_env.length > 0 && (
              <p className="text-sm text-amber-300">
                Faltan variables de entorno en el back: <span className="font-mono">{c.missing_env.join(", ")}</span>
              </p>
            )}

            {c.connected && (
              <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Cuenta</dt>
                  <dd className="font-mono text-foreground">
                    {c.username ?? "—"} ({c.platform_user_id})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Conectada</dt>
                  <dd className="text-foreground">{formatDate(c.connected_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Token caduca</dt>
                  <dd className="text-foreground">{formatDate(c.token_expires_at)} (se renueva solo)</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Última comprobación de suscripciones</dt>
                  <dd className="text-foreground">{formatDate(c.subscriptions_checked_at)}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">Permisos concedidos</dt>
                  <dd className="font-mono text-foreground">{c.scopes ?? "—"}</dd>
                </div>
              </dl>
            )}

            {c.connected && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Suscripciones a eventos</h3>
                {c.subscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguna todavía. Pulsa «Reintentar suscripciones».</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {c.subscriptions.map((s) => (
                      <li key={s.type} className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            s.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {s.status === "active" ? "Activa" : "Error"}
                        </span>
                        <span className="text-foreground">{EVENT_LABELS[s.type] ?? s.type}</span>
                        <span className="font-mono text-xs text-muted-foreground">{s.type}</span>
                        {s.error && <span className="text-xs text-red-300">{s.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {c.last_error && <p className="text-sm text-red-300">Último error: {c.last_error}</p>}

            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>
                URL de redirección OAuth (a registrar en la app de {name}):{" "}
                <span className="font-mono text-foreground">{c.redirect_uri ?? "falta BACKEND_BASE_URL"}</span>
              </p>
              {c.platform === "kick" && (
                <p>
                  URL de webhook (a configurar en la app de Kick):{" "}
                  <span className="font-mono text-foreground">{c.webhook_url ?? "falta BACKEND_BASE_URL"}</span>
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
