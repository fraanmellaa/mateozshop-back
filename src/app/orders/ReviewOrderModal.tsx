"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { passOrderToNext, reviewOrder } from "@/app/utils/orders/actions";

/**
 * Aprobar o rechazar un pedido que requiere revisión manual. En un premio VIP
 * la revisión es comprobar la verificación del ganador: se confirma o, con
 * `passNext`, el premio se vuelve a poner en puja (sin devolver los puntos).
 */
export default function ReviewOrderModal({
  orderId,
  approve,
  vip = false,
  passNext = false,
  isOpen,
  onClose,
  onDone,
}: {
  orderId: number | null;
  approve: boolean;
  /** Premio VIP: «Aprobar» se llama «Confirmar». */
  vip?: boolean;
  /** Volver a poner en puja el premio VIP, sin devolver los puntos (manda sobre `approve`). */
  passNext?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    if (orderId === null) return;
    setIsLoading(true);
    try {
      if (passNext) {
        const result = await passOrderToNext(orderId, note);
        if (result.success) {
          toast.success(
            result.action === "passed"
              ? `Premio adjudicado a la siguiente puja${result.username ? ` (${result.username})` : ""}: pedido #${result.newOrderId}, pendiente de comprobar`
              : "Pedido anulado: el premio se ha vuelto a poner en puja. Ponle una fecha de apertura nueva en Premios"
          );
          setNote("");
          onDone();
        } else {
          toast.error(result.error || "Error al volver a poner el premio en puja");
        }
        return;
      }
      const result = await reviewOrder(orderId, approve, note);
      if (result.success) {
        if ("warning" in result && result.warning) toast.warning(result.warning);
        else
          toast.success(
            approve
              ? vip
                ? "Premio VIP confirmado"
                : "Pedido aprobado"
              : "Pedido rechazado y puntos devueltos al usuario"
          );
        setNote("");
        onDone();
      } else {
        toast.error(result.error || "Error al revisar el pedido");
      }
    } catch {
      toast.error("Error al revisar el pedido");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {passNext ? "Volver a poner en puja" : approve ? (vip ? "Confirmar" : "Aprobar") : "Rechazar"} el pedido #{orderId}
          </DialogTitle>
          <DialogDescription>
            {passNext
              ? "El ganador no ha acreditado su registro: se anula este pedido, sus puntos VIP NO se devuelven y el premio se vuelve a poner en puja. Queda cerrado hasta que le pongas una fecha de apertura nueva."
              : approve
                ? vip
                  ? "Confirmas que has comprobado la verificación del ganador. Si lleva código, se enviará al usuario por email."
                  : "Si lleva código, se enviará al usuario por email."
                : "El pedido se cancela y se devuelven los puntos al usuario. Indica el motivo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="review-note">{passNext || approve ? "Nota (opcional)" : "Motivo"}</Label>
          <textarea
            id="review-note"
            className="h-24 w-full rounded-md border p-2 text-sm"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={approve && !passNext ? "default" : "destructive"}
            disabled={isLoading || (!passNext && !approve && !note.trim())}
            onClick={handleConfirm}
          >
            {isLoading
              ? "Guardando..."
              : passNext
                ? "Volver a poner en puja"
                : approve
                  ? vip
                    ? "Confirmar"
                    : "Aprobar"
                  : "Rechazar y devolver puntos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
