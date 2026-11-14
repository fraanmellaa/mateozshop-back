"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type LeaderboardPrize = {
  id?: number;
  position: number;
  reward: string;
};

// `key` es un identificador estable de la fila del formulario: si la key de
// React dependiera de `position`, el input perdería el foco al teclear.
type FormPrize = {
  key: number;
  position: number;
  reward: string;
};

type LeaderboardResult = {
  id: number;
  leaderboard_id: number;
  // null cuando el resultado está descalificado (su puesto era original_position).
  position: number | null;
  original_position?: number | null;
  user_id: number;
  username: string | null;
  user_image?: string | null;
  video_id: string;
  video_title: string;
  video_cover_image_url?: string | null;
  video_share_url?: string | null;
  view_count: number;
  // null en los suplentes (status "substitute").
  reward: string | null;
  status: string;
  review_note?: string | null;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

type LeaderboardItem = {
  id: number;
  title: string;
  description?: string | null;
  start_at: number;
  end_at: number;
  status: string;
  finalized_at?: number | null;
  review_notes?: string | null;
  has_reallocation?: boolean;
  reallocation_count?: number;
  prizes: LeaderboardPrize[];
  results: LeaderboardResult[];
};

type LiveVideo = {
  video_row_id: number;
  user_id: number;
  username: string | null;
  video_id: string;
  video_title: string;
  video_share_url: string | null;
  view_count: number;
  created_at: number;
  last_refreshed_at: number | null;
  refresh_failures: number;
  is_banned: boolean;
  user_banned: boolean;
  excluded_reason: string | null;
  position: number | null;
  reward: string | null;
};

type FormState = {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  prizes: FormPrize[];
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programada",
  active: "Activa",
  finalizing: "Finalizando (refrescando contadores)",
  in_review: "En revisión",
  closed: "Cerrada",
  cancelled: "Cancelada",
  pending_review: "Pendiente de revisión",
  approved: "Aprobado",
  rejected: "Rechazado",
  prize_delivered: "Premio entregado",
  disqualified: "Descalificado",
  substitute: "Suplente",
};

const EXCLUDED_LABELS: Record<string, string> = {
  video_banned: "Vídeo vetado",
  user_banned: "Usuario baneado",
  unavailable: "Borrado o privado en TikTok",
  outside_window: "Publicado fuera de las fechas",
  not_best_video: "El usuario tiene otro vídeo mejor",
};

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "La sesión ha caducado. Vuelve a iniciar sesión.",
  LEADERBOARD_END_IN_PAST: "La fecha de fin tiene que ser futura.",
  LEADERBOARD_INVALID_RANGE: "El inicio tiene que ser anterior al fin.",
  LEADERBOARD_INVALID_DATES: "Las fechas no son válidas.",
  LEADERBOARD_TITLE_REQUIRED: "Falta el título.",
  LEADERBOARD_PRIZES_REQUIRED: "Añade al menos un premio.",
  LEADERBOARD_PRIZES_DUPLICATED_POSITION: "Hay dos premios para el mismo puesto.",
  LEADERBOARD_OVERLAP_NOT_ALLOWED: "Las fechas se solapan con otra leaderboard.",
  LEADERBOARD_LOCKED_FOR_EDIT: "Esta leaderboard ya no se puede editar.",
  LEADERBOARD_INVALID_TRANSITION: "La leaderboard no admite ese cambio de estado.",
  LEADERBOARD_NOT_IN_REVIEW: "La leaderboard no está en revisión.",
  LEADERBOARD_CLOSED: "La leaderboard está cerrada: solo se puede marcar la entrega del premio.",
  LEADERBOARD_NOT_FOUND: "La leaderboard ya no existe.",
  RESULT_DISQUALIFIED: "Ese resultado está descalificado.",
  RESULT_WITHOUT_PRIZE: "Ese resultado es un suplente sin premio.",
  RESULT_CHANGED_RETRY: "El resultado ha cambiado. Recarga e inténtalo de nuevo.",
  RESULT_NOT_FOUND: "El resultado ya no existe.",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => null);
  const code =
    response.status === 401 ? "UNAUTHORIZED" : payload?.error || "INTERNAL_SERVER_ERROR";
  return ERROR_MESSAGES[code] || `Error: ${code}`;
}

let nextPrizeKey = 1;
function newPrizeKey() {
  nextPrizeKey += 1;
  return nextPrizeKey;
}

function toUnix(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function toDateTimeLocal(timestamp: number) {
  const d = new Date(timestamp * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  start_at: "",
  end_at: "",
  prizes: [{ key: 1, position: 1, reward: "" }],
};

export default function PageBody({
  initialLeaderboards,
}: {
  initialLeaderboards: LeaderboardItem[];
}) {
  const router = useRouter();

  const [leaderboards, setLeaderboards] = useState<LeaderboardItem[]>(
    initialLeaderboards
  );
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openReviewId, setOpenReviewId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveBoardId, setLiveBoardId] = useState<number | null>(null);
  const [liveVideos, setLiveVideos] = useState<LiveVideo[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const active = useMemo(
    () => leaderboards.filter((item) => item.status === "active"),
    [leaderboards]
  );

  const sorted = useMemo(
    () =>
      [...leaderboards].sort((a, b) => {
        if (a.start_at === b.start_at) return b.id - a.id;
        return b.start_at - a.start_at;
      }),
    [leaderboards]
  );

  const openedLeaderboard = useMemo(
    () => leaderboards.find((item) => item.id === openReviewId) || null,
    [leaderboards, openReviewId]
  );

  const liveLeaderboard = useMemo(
    () => leaderboards.find((item) => item.id === liveBoardId) || null,
    [leaderboards, liveBoardId]
  );

  // Por cada puesto del que se descalificó a alguien: quién lo perdió y quién
  // lo ocupa ahora tras subir los siguientes.
  const reallocationChains = useMemo(() => {
    if (!openedLeaderboard) return [];

    const byPosition = new Map<number, LeaderboardResult[]>();

    for (const result of openedLeaderboard.results) {
      if (result.status !== "disqualified" || !result.original_position) continue;
      const list = byPosition.get(result.original_position) || [];
      list.push(result);
      byPosition.set(result.original_position, list);
    }

    return Array.from(byPosition.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([position, disqualified]) => {
        const current = openedLeaderboard.results.find(
          (result) => result.position === position
        );

        return {
          position,
          reward:
            current?.reward ||
            openedLeaderboard.prizes.find((prize) => prize.position === position)?.reward ||
            "sin premio",
          chain: [
            ...disqualified.map(
              (result) => `${result.username || "Usuario"} (descalificado)`
            ),
            current ? current.username || "Usuario" : "Sin reemplazo apto",
          ],
        };
      });
  }, [openedLeaderboard]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCreating(false);
    setEditingId(null);
  };

  const refreshData = async () => {
    // Si falla (p. ej. sesión caducada) se conserva la lista y se avisa, en vez
    // de vaciarla.
    try {
      const response = await fetch("/api/admin/tiktok/leaderboards", {
        cache: "no-store",
      });

      if (!response.ok) {
        setLoadError(await readError(response));
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload?.result)) {
        setLoadError("No se ha podido recargar la lista de leaderboards.");
        return;
      }

      setLoadError(null);
      setLeaderboards(payload.result);
      router.refresh();
    } catch {
      setLoadError("No se ha podido recargar la lista de leaderboards.");
    }
  };

  const loadLiveRanking = async (leaderboardId: number) => {
    setLiveBoardId(leaderboardId);
    setLiveError(null);

    try {
      const response = await fetch(
        `/api/admin/tiktok/leaderboards/${leaderboardId}/ranking`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        setLiveError(await readError(response));
        return;
      }

      const payload = await response.json().catch(() => null);
      setLiveVideos(Array.isArray(payload?.result?.videos) ? payload.result.videos : []);
    } catch {
      setLiveError("No se ha podido cargar el ranking en vivo.");
    }
  };

  const toggleLiveRanking = (leaderboardId: number) => {
    if (liveBoardId === leaderboardId) {
      setLiveBoardId(null);
      setLiveVideos(null);
      return;
    }
    setLiveVideos(null);
    void loadLiveRanking(leaderboardId);
  };

  const setVideoBanned = async (video: LiveVideo, isBanned: boolean) => {
    if (
      isBanned &&
      !confirm(`¿Vetar el vídeo "${video.video_title}"? Dejará de contar en el ranking.`)
    ) {
      return;
    }

    const response = await fetch(`/api/admin/tiktok/videos/${video.video_row_id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_banned: isBanned }),
    });

    if (!response.ok) {
      alert(await readError(response));
      return;
    }

    if (liveBoardId !== null) await loadLiveRanking(liveBoardId);
  };

  const startCreate = () => {
    resetForm();
    setCreating(true);
  };

  const startEdit = (item: LeaderboardItem) => {
    setCreating(false);
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description || "",
      start_at: toDateTimeLocal(item.start_at),
      end_at: toDateTimeLocal(item.end_at),
      prizes:
        item.prizes.length > 0
          ? item.prizes.map((prize) => ({
              key: newPrizeKey(),
              position: prize.position,
              reward: prize.reward,
            }))
          : [{ key: newPrizeKey(), position: 1, reward: "" }],
    });
  };

  const saveForm = async () => {
    if (!form.title || !form.start_at || !form.end_at) {
      alert("Completa titulo, inicio y fin.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        title: form.title,
        description: form.description,
        start_at: toUnix(form.start_at),
        end_at: toUnix(form.end_at),
        prizes: form.prizes.map((prize) => ({
          position: prize.position,
          reward: prize.reward,
        })),
      };

      const endpoint =
        editingId !== null
          ? `/api/admin/tiktok/leaderboards/${editingId}`
          : "/api/admin/tiktok/leaderboards";
      const method = editingId !== null ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        alert(await readError(response));
        return;
      }

      resetForm();
      await refreshData();
    } finally {
      setSaving(false);
    }
  };

  const removeLeaderboard = async (id: number) => {
    if (!confirm("¿Eliminar la leaderboard? Se borran también sus premios y resultados.")) return;

    const response = await fetch(`/api/admin/tiktok/leaderboards/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      alert(await readError(response));
      return;
    }

    await refreshData();
  };

  const updateResultStatus = async (
    resultId: number,
    status: "approved" | "rejected" | "prize_delivered" | "disqualified"
  ) => {
    let reviewNote: string | undefined;
    if (status === "disqualified") {
      const provided = window.prompt(
        "Motivo de descalificacion (opcional):",
        "Usuario descalificado manualmente"
      );
      if (provided === null) return;
      reviewNote = provided;
    }

    const response = await fetch(
      `/api/admin/tiktok/leaderboards/results/${resultId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status, review_note: reviewNote }),
      }
    );

    if (!response.ok) {
      alert(await readError(response));
      return;
    }

    await refreshData();
  };

  const setLeaderboardStatus = async (
    leaderboardId: number,
    status: "closed" | "cancelled"
  ) => {
    const question =
      status === "closed"
        ? "¿Cerrar la revisión? Después solo se podrá marcar la entrega de premios; no se podrá aprobar, rechazar ni descalificar."
        : "¿Cancelar la leaderboard? No se puede deshacer y deja de mostrarse al público.";
    if (!confirm(question)) return;

    const response = await fetch(`/api/admin/tiktok/leaderboards/${leaderboardId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "set_status",
        status,
      }),
    });

    if (!response.ok) {
      alert(await readError(response));
      return;
    }

    await refreshData();
  };

  return (
    <div className="space-y-6 pt-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Configuracion de leaderboards</h2>
            <p className="text-sm text-muted-foreground">
              Crea periodos con premios por puesto. Solo se permite una leaderboard por franja.
            </p>
          </div>
          <Button onClick={startCreate}>Nueva leaderboard</Button>
        </div>

        {(creating || editingId !== null) && (
          <div className="mt-4 grid gap-3 rounded-md border border-border p-4">
            <Input
              placeholder="Titulo"
              value={form.title}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
            <Textarea
              placeholder="Descripcion (opcional)"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="datetime-local"
                value={form.start_at}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, start_at: event.target.value }))
                }
              />
              <Input
                type="datetime-local"
                value={form.end_at}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, end_at: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Premios por puesto</p>
              {form.prizes.map((prize, index) => (
                <div key={prize.key} className="grid grid-cols-[120px_1fr_auto] gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={prize.position}
                    onChange={(event) => {
                      const value = Number(event.target.value || 1);
                      setForm((prev) => ({
                        ...prev,
                        prizes: prev.prizes.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, position: value }
                            : item
                        ),
                      }));
                    }}
                  />
                  <Input
                    placeholder="Premio"
                    value={prize.reward}
                    onChange={(event) => {
                      const value = event.target.value;
                      setForm((prev) => ({
                        ...prev,
                        prizes: prev.prizes.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, reward: value }
                            : item
                        ),
                      }));
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={form.prizes.length === 1}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        prizes: prev.prizes.filter((_, itemIndex) => itemIndex !== index),
                      }))
                    }
                  >
                    Quitar
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    prizes: [
                      ...prev.prizes,
                      {
                        key: newPrizeKey(),
                        position:
                          prev.prizes.reduce((max, item) => Math.max(max, item.position), 0) + 1,
                        reward: "",
                      },
                    ],
                  }))
                }
              >
                Agregar premio
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={saveForm} disabled={saving}>
                {saving ? "Guardando..." : editingId !== null ? "Guardar cambios" : "Crear leaderboard"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {loadError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Leaderboards activas: <span className="font-semibold text-foreground">{active.length}</span>
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3 text-left">Titulo</th>
              <th className="p-3 text-left">Estado</th>
              <th className="p-3 text-left">Inicio</th>
              <th className="p-3 text-left">Fin</th>
              <th className="p-3 text-left">Premios</th>
              <th className="p-3 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="p-3">
                  <p className="font-medium">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  )}
                </td>
                <td className="p-3">{statusLabel(item.status)}</td>
                <td className="p-3">{new Date(item.start_at * 1000).toLocaleString("es-ES")}</td>
                <td className="p-3">{new Date(item.end_at * 1000).toLocaleString("es-ES")}</td>
                <td className="p-3">
                  {item.prizes.map((prize) => (
                    <div key={`${item.id}-${prize.position}`}>
                      #{prize.position}: {prize.reward}
                    </div>
                  ))}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {(item.status === "scheduled" || item.status === "active") && (
                      <Button variant="outline" onClick={() => startEdit(item)}>
                        Editar
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => toggleLiveRanking(item.id)}>
                      {liveBoardId === item.id ? "Ocultar vídeos" : "Vídeos y ranking"}
                    </Button>
                    {(item.status === "in_review" || item.status === "closed") && (
                      <Button variant="outline" onClick={() => setOpenReviewId(openReviewId === item.id ? null : item.id)}>
                        Revisar
                      </Button>
                    )}
                    {(item.has_reallocation || (item.reallocation_count || 0) > 0) && (
                      <span className="inline-flex items-center rounded-full bg-amber-500/20 text-amber-300 px-2 py-1 text-xs">
                        Reajustes: {item.reallocation_count || 0}
                      </span>
                    )}
                    {item.status === "in_review" && (
                      <Button variant="outline" onClick={() => setLeaderboardStatus(item.id, "closed")}>
                        Cerrar
                      </Button>
                    )}
                    {(item.status === "scheduled" ||
                      item.status === "active" ||
                      item.status === "finalizing") && (
                      <Button variant="outline" onClick={() => setLeaderboardStatus(item.id, "cancelled")}>
                        Cancelar
                      </Button>
                    )}
                    <Button variant="destructive" onClick={() => removeLeaderboard(item.id)}>
                      Eliminar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {liveBoardId !== null && (
        <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">
                Vídeos asociados y ranking en vivo
                {liveLeaderboard ? ` · ${liveLeaderboard.title}` : ""}
              </h3>
              <p className="text-sm text-muted-foreground">
                Cuenta el mejor vídeo de cada usuario, publicado dentro de las fechas. Un vídeo
                vetado no cuenta en el ranking ni en el snapshot final.
              </p>
            </div>
            <Button variant="outline" onClick={() => loadLiveRanking(liveBoardId)}>
              Recargar
            </Button>
          </div>

          {liveError && <p className="mt-3 text-sm text-red-300">{liveError}</p>}
          {!liveError && liveVideos === null && (
            <p className="mt-3 text-sm text-muted-foreground">Cargando...</p>
          )}
          {liveVideos !== null && liveVideos.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Todavía no hay vídeos asociados a esta leaderboard.
            </p>
          )}

          {liveVideos !== null && liveVideos.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2 text-left">Puesto</th>
                  <th className="p-2 text-left">Usuario</th>
                  <th className="p-2 text-left">Vídeo</th>
                  <th className="p-2 text-left">Views</th>
                  <th className="p-2 text-left">Último refresco</th>
                  <th className="p-2 text-left">Situación</th>
                  <th className="p-2 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {liveVideos.map((video) => (
                  <tr key={video.video_row_id} className="border-b border-border/60">
                    <td className="p-2">{video.position !== null ? `#${video.position}` : "-"}</td>
                    <td className="p-2">{video.username || `Usuario ${video.user_id}`}</td>
                    <td className="p-2">
                      {video.video_share_url ? (
                        <a
                          href={video.video_share_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {video.video_title}
                        </a>
                      ) : (
                        video.video_title
                      )}
                    </td>
                    <td className="p-2">{video.view_count.toLocaleString("es-ES")}</td>
                    <td className="p-2">
                      {video.last_refreshed_at
                        ? new Date(video.last_refreshed_at * 1000).toLocaleString("es-ES")
                        : "-"}
                    </td>
                    <td className="p-2">
                      {video.excluded_reason ? (
                        <span className="text-amber-300">
                          No cuenta: {EXCLUDED_LABELS[video.excluded_reason] || video.excluded_reason}
                        </span>
                      ) : video.reward ? (
                        `Premio: ${video.reward}`
                      ) : (
                        "Cuenta"
                      )}
                    </td>
                    <td className="p-2">
                      {video.is_banned ? (
                        <Button size="sm" variant="outline" onClick={() => setVideoBanned(video, false)}>
                          Quitar veto
                        </Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => setVideoBanned(video, true)}>
                          Vetar vídeo
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {liveLeaderboard &&
            (liveLeaderboard.status === "in_review" || liveLeaderboard.status === "closed") && (
              <p className="mt-3 text-xs text-muted-foreground">
                Esta leaderboard ya tiene snapshot final: vetar un vídeo aquí no cambia los
                resultados. Para quitar a un ganador usa &quot;Descalificar&quot; en la revisión.
              </p>
            )}
        </div>
      )}

      {openReviewId !== null && openedLeaderboard && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-base font-semibold">
            Revisión manual de resultados · {openedLeaderboard.title}
          </h3>
          <p className="text-sm text-muted-foreground">
            Al descalificar a alguien, los siguientes suben un puesto y heredan el premio de ese
            puesto; el primer suplente entra en el último puesto premiado.
          </p>

          {reallocationChains.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-300">
                Cadena de reajuste de puestos
              </p>
              <div className="mt-2 space-y-1 text-sm text-amber-200">
                {reallocationChains.map((item) => (
                  <p key={`chain-${item.position}`}>
                    #{item.position} ({item.reward}): {item.chain.join(" -> ")}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {openedLeaderboard.results.map((result) => {
              const inReview = openedLeaderboard.status === "in_review";
              const isDisqualified = result.status === "disqualified";
              const isSubstitute = result.status === "substitute";
              const hasPrize = !isDisqualified && !isSubstitute;

              return (
                <div key={result.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {isDisqualified
                      ? `Descalificado (era #${result.original_position ?? "-"})`
                      : `Puesto #${result.position}`}{" "}
                    - {result.username || `Usuario ${result.user_id}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {result.video_title} · {result.view_count.toLocaleString("es-ES")} views
                  </p>
                  {hasPrize && <p className="text-sm">Premio: {result.reward}</p>}
                  <p className="text-xs text-muted-foreground">
                    Estado: {statusLabel(result.status)}
                  </p>
                  {result.review_note && (
                    <p className="text-xs text-amber-300">Nota: {result.review_note}</p>
                  )}
                  {!isDisqualified && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {hasPrize && inReview && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateResultStatus(result.id, "approved")}
                            disabled={result.status === "approved"}
                          >
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateResultStatus(result.id, "rejected")}
                            disabled={result.status === "rejected"}
                          >
                            Rechazar
                          </Button>
                        </>
                      )}
                      {hasPrize && (
                        <Button
                          size="sm"
                          onClick={() => updateResultStatus(result.id, "prize_delivered")}
                          disabled={result.status === "prize_delivered"}
                        >
                          Marcar entregado
                        </Button>
                      )}
                      {inReview && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => updateResultStatus(result.id, "disqualified")}
                        >
                          Descalificar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {openedLeaderboard.results.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay resultados preparados para revisar.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
