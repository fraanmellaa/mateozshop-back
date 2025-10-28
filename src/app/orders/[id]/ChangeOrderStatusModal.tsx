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
import { Label } from "@/components/ui/label";

interface ChangeOrderStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (newStatus: number) => void;
  currentStatus: number;
  orderId: number;
}

export default function ChangeOrderStatusModal({
  isOpen,
  onClose,
  onConfirm,
  currentStatus,
  orderId,
}: ChangeOrderStatusModalProps) {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);
  const [isLoading, setIsLoading] = useState(false);

  const statusOptions = [
    { value: 0, label: "Pendiente", color: "text-yellow-600" },
    { value: 1, label: "Completada", color: "text-green-600" },
    { value: 2, label: "Cancelada", color: "text-red-600" },
  ];

  const handleSubmit = async () => {
    if (selectedStatus === currentStatus) {
      onClose();
      return;
    }

    setIsLoading(true);
    try {
      await onConfirm(selectedStatus);
      onClose();
    } catch (error) {
      console.error("Error changing status:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const currentStatusInfo = statusOptions.find(
    (s) => s.value === currentStatus
  );
  const selectedStatusInfo = statusOptions.find(
    (s) => s.value === selectedStatus
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Cambiar Estado del Pedido</DialogTitle>
          <DialogDescription>
            Cambiar el estado del pedido #{orderId}
            <br />
            <span className="text-sm text-muted-foreground">
              Estado actual:{" "}
              <span className={currentStatusInfo?.color}>
                {currentStatusInfo?.label}
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="status">Nuevo Estado</Label>
            <select
              id="status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(parseInt(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 mt-2"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {selectedStatus !== currentStatus && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                El estado cambiará de{" "}
                <strong>{currentStatusInfo?.label}</strong> a{" "}
                <strong className={selectedStatusInfo?.color}>
                  {selectedStatusInfo?.label}
                </strong>
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || selectedStatus === currentStatus}
          >
            {isLoading ? "Cambiando..." : "Confirmar Cambio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
