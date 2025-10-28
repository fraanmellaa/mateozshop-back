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

interface AddPointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (points: number) => void;
  username: string;
}

export default function AddPointsModal({
  isOpen,
  onClose,
  onConfirm,
  username,
}: AddPointsModalProps) {
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
      console.error("Error adding points:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPoints("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Añadir Puntos</DialogTitle>
          <DialogDescription>
            Añadir puntos al usuario <strong>{username}</strong>
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
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="col-span-3"
              placeholder="Ingresa la cantidad de puntos"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !points}>
              {isLoading ? "Añadiendo..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}