"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ResetPointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  username: string;
  currentPoints: number;
}

export default function ResetPointsModal({
  isOpen,
  onClose,
  onConfirm,
  username,
  currentPoints,
}: ResetPointsModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error("Error resetting points:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Resetear Puntos</DialogTitle>
          <DialogDescription>
            ¿Estás seguro de que quieres resetear los puntos del usuario{" "}
            <strong>{username}</strong>?
            <br />
            <br />
            <span className="text-sm text-muted-foreground">
              Puntos actuales: {currentPoints}
            </span>
            <br />
            <span className="text-sm text-red-500 font-medium">
              Esta acción no se puede deshacer.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? "Reseteando..." : "Sí, Resetear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
