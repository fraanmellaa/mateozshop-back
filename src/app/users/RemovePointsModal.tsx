"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface RemovePointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (points: number) => void;
  username: string;
  currentPoints: number;
}

export default function RemovePointsModal({
  isOpen,
  onClose,
  onConfirm,
  username,
  currentPoints,
}: RemovePointsModalProps) {
  const [points, setPoints] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!points || parseInt(points) <= 0) return;

    setIsLoading(true);
    try {
      await onConfirm(parseInt(points));
      handleClose();
    } catch (error) {
      console.error("Error removing points:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPoints("");
    onClose();
  };

  const maxPoints = currentPoints;
  const pointsToRemove = parseInt(points) || 0;
  const isValidAmount = pointsToRemove > 0 && pointsToRemove <= maxPoints;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Quitar Puntos</DialogTitle>
          <DialogDescription>
            Quitar puntos al usuario <strong>{username}</strong>
            <br />
            <span className="text-sm text-muted-foreground">
              Puntos actuales: {currentPoints}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="points" className="text-right">
              Puntos
            </Label>
            <Input
              id="points"
              type="number"
              min="1"
              max={maxPoints}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="col-span-3"
              placeholder="Ingresa la cantidad de puntos"
              required
            />
          </div>

          {points && !isValidAmount && (
            <div className="text-sm text-red-500">
              {pointsToRemove > maxPoints
                ? `No se pueden quitar más de ${maxPoints} puntos`
                : "Ingresa una cantidad válida"}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !isValidAmount}
              variant="destructive"
            >
              {isLoading ? "Quitando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
