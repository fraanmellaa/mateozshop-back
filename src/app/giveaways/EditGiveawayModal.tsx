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
import { Textarea } from "@/components/ui/textarea";
import type { DecoratedGiveaway } from "../utils/giveaways/admin";
import { fromDateTimeLocal, toDateTimeLocal } from "../utils/datetime";

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
    rules: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (giveaway) {
      // Fecha y hora en hora local, igual que se interpretan al guardar.
      const [startDate, startTime] = toDateTimeLocal(giveaway.start_at).split("T");
      const [endDate, endTime] = toDateTimeLocal(giveaway.end_at).split("T");

      // Patrón habitual (copiar al estado lo que llega de fuera o de una carga): no provoca renders en cadena aquí.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        title: giveaway.title,
        image: giveaway.image,
        cost: giveaway.cost.toString(),
        start_date: startDate,
        start_time: startTime,
        end_date: endDate,
        end_time: endTime,
        rules: giveaway.rules ?? "",
      });
    }
  }, [giveaway]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!giveaway) return;

    setIsLoading(true);

    try {
      // Convertir fechas y horas a timestamps Unix
      const start_at = fromDateTimeLocal(
        `${formData.start_date}T${formData.start_time}`
      );
      const end_at = fromDateTimeLocal(
        `${formData.end_date}T${formData.end_time}`
      );

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
          // Tras el sorteo las bases quedan bloqueadas.
          ...(giveaway.drawn_at === null ? { rules: formData.rules } : {}),
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
      rules: "",
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
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

          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="rules" className="pt-2 text-right">
              Bases
            </Label>
            <div className="col-span-3">
              <Textarea
                id="rules"
                rows={5}
                maxLength={10000}
                value={formData.rules}
                disabled={giveaway?.drawn_at !== null}
                onChange={(e) => setFormData({ ...formData, rules: e.target.value })}
                placeholder="Bases del sorteo: quién puede participar, premio, entrega..."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {giveaway?.drawn_at !== null
                  ? "El sorteo ya se hizo: las bases no se pueden cambiar."
                  : "Se publican con el sorteo y en las bases legales."}
              </p>
              {giveaway?.draw_seed_hash && (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  Hash del sorteo (público): <span className="font-mono">{giveaway.draw_seed_hash}</span>
                </p>
              )}
            </div>
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
