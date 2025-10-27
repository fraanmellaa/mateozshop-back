"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

interface CreateGiveawayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateGiveawayModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateGiveawayModalProps) {
  const [formData, setFormData] = useState({
    title: "",
    image: "",
    cost: "",
    start_date: "",
    start_time: "",
    end_date: "",
    end_time: "",
    sendable: false,
    codes: [""],
  });
  const [isLoading, setIsLoading] = useState(false);

  const addCodeField = () => {
    setFormData({ ...formData, codes: [...formData.codes, ""] });
  };

  const removeCodeField = (index: number) => {
    const newCodes = formData.codes.filter((_, i) => i !== index);
    setFormData({ ...formData, codes: newCodes });
  };

  const updateCode = (index: number, value: string) => {
    const newCodes = [...formData.codes];
    newCodes[index] = value;
    setFormData({ ...formData, codes: newCodes });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Convertir fechas y horas a timestamps Unix
      const startDateTime = new Date(
        `${formData.start_date}T${formData.start_time}`
      );
      const endDateTime = new Date(`${formData.end_date}T${formData.end_time}`);

      const start_at = Math.floor(startDateTime.getTime() / 1000);
      const end_at = Math.floor(endDateTime.getTime() / 1000);

      const response = await fetch("/api/admin/giveaways", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title,
          image: formData.image,
          cost: parseInt(formData.cost),
          start_at,
          end_at,
          sendable: formData.sendable,
          codes: formData.sendable
            ? formData.codes.filter((code) => code.trim() !== "")
            : [],
        }),
      });

      if (response.ok) {
        onSuccess();
        setFormData({
          title: "",
          image: "",
          cost: "",
          start_date: "",
          start_time: "",
          end_date: "",
          end_time: "",
          sendable: false,
          codes: [""],
        });
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Error creating giveaway:", error);
      alert("Error al crear el sorteo");
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
      sendable: false,
      codes: [""],
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Crear Nuevo Sorteo</DialogTitle>
          <DialogDescription>
            Completa los datos para crear un nuevo sorteo.
          </DialogDescription>
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

          {/* Campo Sendable */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="sendable" className="text-right">
              Sorteo Enviable
            </Label>
            <div className="col-span-3 flex items-center space-x-2">
              <Checkbox
                id="sendable"
                checked={formData.sendable}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    sendable: Boolean(checked),
                    codes: Boolean(checked) ? formData.codes : [""],
                  })
                }
              />
              <Label htmlFor="sendable" className="text-sm">
                Este sorteo requiere códigos para entregar
              </Label>
            </div>
          </div>

          {/* Códigos (solo si sendable es true) */}
          {formData.sendable && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Códigos del Sorteo</Label>
              {formData.codes.map((code, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e) => updateCode(index, e.target.value)}
                    placeholder={`Código ${index + 1}`}
                    className="flex-1"
                  />
                  {formData.codes.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeCodeField(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCodeField}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Agregar Código
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creando..." : "Crear Sorteo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
