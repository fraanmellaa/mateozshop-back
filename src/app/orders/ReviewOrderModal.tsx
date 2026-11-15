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
import { reviewOrder } from "@/app/utils/orders/actions";

/** Aprobar o rechazar un pedido que requiere revisión manual. */
export default function ReviewOrderModal({
  orderId,
  approve,
  isOpen,
  onClose,
  onDone,
}: {
  orderId: number | null;
  approve: boolean;
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
      const result = await reviewOrder(orderId, approve, note);
      if (result.success) {
        if ("warning" in result && result.warning) toast.warning(result.warning);
        else
          toast.success(
            approve ? "Pedido aprobado" : "Pedido rechazado y puntos devueltos al usuario"
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
            {approve ? "Aprobar" : "Rechazar"} el pedido #{orderId}
          </DialogTitle>
          <DialogDescription>
            {approve
              ? "Si lleva código, se enviará al usuario por email."
              : "El pedido se cancela y se devuelven los puntos al usuario. Indica el motivo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="review-note">{approve ? "Nota (opcional)" : "Motivo"}</Label>
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
            variant={approve ? "default" : "destructive"}
            disabled={isLoading || (!approve && !note.trim())}
            onClick={handleConfirm}
          >
            {isLoading ? "Guardando..." : approve ? "Aprobar" : "Rechazar y devolver puntos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
