"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, MessageSquare } from "lucide-react";
import SendWinnerEmailModal from "./SendWinnerEmailModal";

interface Comment {
  created_at: number;
  message: string;
}

interface GiveawayDetailClientProps {
  giveaway: {
    id: number;
    title: string;
    comments: Comment[];
    winners: Array<{ id: number; name: string; profileImage: string }>;
  };
  status: string;
}

export default function GiveawayDetailClient({
  giveaway,
  status,
}: GiveawayDetailClientProps) {
  const [comments, setComments] = useState<Comment[]>(giveaway.comments || []);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      alert("El comentario no puede estar vacío");
      return;
    }

    setIsAddingComment(true);
    try {
      const response = await fetch(
        `/api/admin/giveaways/${giveaway.id}/comment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: newComment.trim() }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        setComments([result.comment, ...comments]); // Agregar al inicio para mostrar los más recientes primero
        setNewComment("");
        alert("Comentario agregado correctamente");
      } else {
        const error = await response.json();
        alert(error.error || "Error al agregar comentario");
      }
    } catch (error) {
      console.error("Error adding comment:", error);
      alert("Error al agregar comentario");
    } finally {
      setIsAddingComment(false);
    }
  };

  const handleSendEmail = async (subject: string, message: string) => {
    if (giveaway.winners.length === 0) {
      alert("No hay ganador para enviar email");
      return;
    }

    try {
      const response = await fetch(
        `/api/giveaways/${giveaway.id}/send-winner-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            winnerId: giveaway.winners[0].id,
            subject,
            message,
          }),
        }
      );

      if (response.ok) {
        alert("Email enviado al ganador correctamente");
        setShowEmailModal(false);
      } else {
        const error = await response.json();
        alert(error.error || "Error al enviar email");
      }
    } catch (error) {
      console.error("Error sending email:", error);
      alert("Error al enviar email");
    }
  };

  return (
    <div className="space-y-6">
      {/* Acciones para sorteos finalizados con ganador */}
      {status === "finished" && giveaway.winners.length > 0 && (
        <div className="bg-card rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-bold mb-4">Acciones</h3>
          <Button
            onClick={() => setShowEmailModal(true)}
            className="w-full mb-2"
          >
            <Mail className="w-4 h-4 mr-2" />
            Enviar email al ganador
          </Button>
        </div>
      )}

      {/* Modal de email personalizado */}
      <SendWinnerEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSend={handleSendEmail}
        winnerEmail=""
        winnerName={giveaway.winners[0]?.name || ""}
        giveawayTitle={giveaway.title}
      />

      {/* Sección de comentarios para sorteos finalizados */}
      {status === "finished" && (
        <div className="bg-card rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Comentarios internos
          </h3>

          {/* Agregar nuevo comentario */}
          <div className="mb-4">
            <div className="flex gap-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Escribir comentario interno..."
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleAddComment();
                  }
                }}
              />
              <Button
                onClick={handleAddComment}
                disabled={isAddingComment || !newComment.trim()}
                size="sm"
              >
                {isAddingComment ? "..." : "Agregar"}
              </Button>
            </div>
          </div>

          {/* Lista de comentarios */}
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {comments.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No hay comentarios internos
              </p>
            ) : (
              comments.map((comment, index) => (
                <div
                  key={index}
                  className="p-3 bg-muted/50 rounded-lg border-l-4 border-blue-500/50"
                >
                  <p className="text-sm mb-1">{comment.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(comment.created_at * 1000).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Información adicional */}
      <div className="bg-card rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-bold mb-4">Información</h3>
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium text-muted-foreground">Estado:</span>
            <span className="ml-2 capitalize">{status}</span>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">ID:</span>
            <span className="ml-2">{giveaway.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
