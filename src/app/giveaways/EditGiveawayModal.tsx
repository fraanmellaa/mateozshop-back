"use client";

import { useState, useEffect } from "react";
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
import { DecoratedGiveaway } from "../utils/giveaways/admin";

interface EditGiveawayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  giveaway: DecoratedGiveaway | null;
}

export default function EditGiveawayModal({
  isOpen,
  onClose,
  onSuccess,
  giveaway,
}: EditGiveawayModalProps) {
  const [formData, setFormData] = useState({
    title: "",
    image: "",
    cost: "",
    start_date: "",
    start_time: "",
    end_date: "",
    end_time: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (giveaway) {
      const startDate = new Date(giveaway.start_at * 1000);
      const endDate = new Date(giveaway.end_at * 1000);

      setFormData({
        title: giveaway.title,
        image: giveaway.image,
        cost: giveaway.cost.toString(),
        start_date: startDate.toISOString().split("T")[0],
        start_time: startDate.toTimeString().slice(0, 5),
        end_date: endDate.toISOString().split("T")[0],
        end_time: endDate.toTimeString().slice(0, 5),
      });
    }
  }, [giveaway]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!giveaway) return;

    setIsLoading(true);

    try {
      // Convertir fechas y horas a timestamps Unix
      const startDateTime = new Date(
        `${formData.start_date}T${formData.start_time}`
      );
      const endDateTime = new Date(`${formData.end_date}T${formData.end_time}`);

      const start_at = Math.floor(startDateTime.getTime() / 1000);
      const end_at = Math.floor(endDateTime.getTime() / 1000);

      const response = await fetch(`/api/admin/giveaways/${giveaway.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title,
          image: formData.image,
          cost: parseInt(formData.cost),
          start_at,
          end_at,
        }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Error updating giveaway:", error);
      alert("Error al actualizar el sorteo");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      title: "",
      image: "",
      cost: "",
      start_date: "",
      start_time: "",
      end_date: "",
      end_time: "",
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Sorteo</DialogTitle>
          <DialogDescription>Modifica los datos del sorteo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right">
              Título
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="image" className="text-right">
              Imagen URL
            </Label>
            <Input
              id="image"
              type="url"
              value={formData.image}
              onChange={(e) =>
                setFormData({ ...formData, image: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="cost" className="text-right">
              Costo (pts)
            </Label>
            <Input
              id="cost"
              type="number"
              min="1"
              value={formData.cost}
              onChange={(e) =>
                setFormData({ ...formData, cost: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="start_date" className="text-right">
              Fecha Inicio
            </Label>
            <Input
              id="start_date"
              type="date"
              value={formData.start_date}
              onChange={(e) =>
                setFormData({ ...formData, start_date: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="start_time" className="text-right">
              Hora Inicio
            </Label>
            <Input
              id="start_time"
              type="time"
              value={formData.start_time}
              onChange={(e) =>
                setFormData({ ...formData, start_time: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="end_date" className="text-right">
              Fecha Fin
            </Label>
            <Input
              id="end_date"
              type="date"
              value={formData.end_date}
              onChange={(e) =>
                setFormData({ ...formData, end_date: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="end_time" className="text-right">
              Hora Fin
            </Label>
            <Input
              id="end_time"
              type="time"
              value={formData.end_time}
              onChange={(e) =>
                setFormData({ ...formData, end_time: e.target.value })
              }
              className="col-span-3"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
