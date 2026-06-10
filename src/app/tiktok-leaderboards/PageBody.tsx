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

type LeaderboardResult = {
  id: number;
  leaderboard_id: number;
  position: number;
  user_id: number;
  username: string;
  user_image?: string | null;
  video_id: string;
  video_title: string;
  video_cover_image_url?: string | null;
  video_share_url?: string | null;
  view_count: number;
  reward: string;
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

type FormState = {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  prizes: LeaderboardPrize[];
};

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
  prizes: [{ position: 1, reward: "" }],
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

  const reallocationChains = useMemo(() => {
    if (!openedLeaderboard) return [];

    const byPosition = new Map<number, LeaderboardResult[]>();

    for (const result of openedLeaderboard.results) {
      const list = byPosition.get(result.position) || [];
      list.push(result);
      byPosition.set(result.position, list);
    }

    return Array.from(byPosition.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([position, results]) => {
        const disqualified = results.filter(
          (result) => result.status === "disqualified"
        );
        const current = results.find(
          (result) => result.status !== "disqualified"
        );

        if (disqualified.length === 0) return null;

        const chain = [
          ...disqualified.map((result) => `${result.username} (descalificado)`),
          current ? current.username : "Sin reemplazo apto",
        ];

        return {
          position,
          reward: current?.reward || disqualified[0]?.reward || "-",
          chain,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [openedLeaderboard]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCreating(false);
    setEditingId(null);
  };

  const refreshData = async () => {
    const response = await fetch("/api/admin/tiktok/leaderboards", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ result: [] }));
    setLeaderboards(Array.isArray(payload?.result) ? payload.result : []);
    router.refresh();
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
              position: prize.position,
              reward: prize.reward,
            }))
          : [{ position: 1, reward: "" }],
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
        prizes: form.prizes,
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

      const res = await response.json().catch(() => null);

      if (!response.ok) {
        alert(`Error: ${res?.error || "INTERNAL_SERVER_ERROR"}`);
        return;
      }

      resetForm();
      await refreshData();
    } finally {
      setSaving(false);
    }
  };

  const removeLeaderboard = async (id: number) => {
    if (!confirm("¿Eliminar leaderboard?")) return;

    const response = await fetch(`/api/admin/tiktok/leaderboards/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      alert(`Error: ${payload?.error || "INTERNAL_SERVER_ERROR"}`);
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
      const payload = await response.json().catch(() => null);
      alert(`Error: ${payload?.error || "INTERNAL_SERVER_ERROR"}`);
      return;
    }

    await refreshData();
  };

  const setLeaderboardStatus = async (
    leaderboardId: number,
    status: "closed" | "cancelled"
  ) => {
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
      const payload = await response.json().catch(() => null);
      alert(`Error: ${payload?.error || "INTERNAL_SERVER_ERROR"}`);
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
                <div key={`${prize.position}-${index}`} className="grid grid-cols-[120px_1fr_auto] gap-2">
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
                    prizes: [...prev.prizes, { position: prev.prizes.length + 1, reward: "" }],
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
                <td className="p-3">{item.status}</td>
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
                    <Button variant="outline" onClick={() => startEdit(item)}>
                      Editar
                    </Button>
                    <Button variant="outline" onClick={() => setOpenReviewId(openReviewId === item.id ? null : item.id)}>
                      Revisar
                    </Button>
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
                    {(item.status === "scheduled" || item.status === "active") && (
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

      {openReviewId !== null && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-base font-semibold">Revision manual de resultados</h3>

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
            {(openedLeaderboard?.results || []).map((result) => (
              <div key={result.id} className="rounded-md border border-border p-3">
                <p className="font-medium">
                  Puesto #{result.position} - {result.username}
                </p>
                <p className="text-sm text-muted-foreground">
                  {result.video_title} · {result.view_count.toLocaleString("es-ES")} views
                </p>
                <p className="text-sm">Premio: {result.reward}</p>
                <p className="text-xs text-muted-foreground">Estado: {result.status}</p>
                {result.review_note && (
                  <p className="text-xs text-amber-300">Nota: {result.review_note}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateResultStatus(result.id, "approved")}
                    disabled={result.status === "disqualified"}
                  >
                    Aprobar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateResultStatus(result.id, "rejected")}
                    disabled={result.status === "disqualified"}
                  >
                    Rechazar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateResultStatus(result.id, "prize_delivered")}
                    disabled={result.status === "disqualified"}
                  >
                    Marcar entregado
                  </Button>
                  {result.status !== "disqualified" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => updateResultStatus(result.id, "disqualified")}
                    >
                      Descalificar
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {(openedLeaderboard?.results || []).length === 0 && (
              <p className="text-sm text-muted-foreground">No hay resultados preparados para revisar.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
