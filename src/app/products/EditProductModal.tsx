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
import { Checkbox } from "@/components/ui/checkbox";
import type { ProductRow } from "@/app/utils/products";
import { fromDateTimeLocal, toDateTimeLocal } from "@/app/utils/datetime";

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  product: ProductRow | null;
}

const EMPTY_FORM = {
  name: "",
  description: "",
  image: "",
  price: "",
  stock: "",
  is_auction: false,
  min_bid_increment: "1",
  auction_cooldown_seconds: "300",
  auction_ends_at: "",
  sendable: false,
  codesText: "",
};

function toForm(product: ProductRow): typeof EMPTY_FORM {
  return {
    name: product.name,
    description: product.description,
    image: product.image,
    price: product.price.toString(),
    stock: product.stock.toString(),
    is_auction: product.is_auction || false,
    min_bid_increment: String(product.min_bid_increment || 1),
    auction_cooldown_seconds: String(product.auction_cooldown_seconds || 300),
    auction_ends_at: product.auction_ends_at
      ? toDateTimeLocal(product.auction_ends_at)
      : "",
    sendable: product.sendable || false,
    codesText: (product.codes || []).join("\n"),
  };
}

export default function EditProductModal({
  isOpen,
  onClose,
  onSuccess,
  product,
}: EditProductModalProps) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData(toForm(product));
    }
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    // Solo se envía lo que el admin ha cambiado: el stock y los códigos pueden
    // haber variado (canjes) desde que se cargó la página, y reenviarlos los
    // restauraría.
    const initial = toForm(product);
    const changes: Record<string, unknown> = {};

    if (formData.name !== initial.name) changes.name = formData.name;
    if (formData.description !== initial.description)
      changes.description = formData.description;
    if (formData.image !== initial.image) changes.image = formData.image;
    if (formData.price !== initial.price) changes.price = formData.price;
    if (formData.stock !== initial.stock) changes.stock = formData.stock;
    if (formData.is_auction !== initial.is_auction)
      changes.is_auction = formData.is_auction;
    if (formData.sendable !== initial.sendable)
      changes.sendable = formData.sendable;

    if (formData.is_auction) {
      if (formData.min_bid_increment !== initial.min_bid_increment)
        changes.min_bid_increment = formData.min_bid_increment;
      if (formData.auction_cooldown_seconds !== initial.auction_cooldown_seconds)
        changes.auction_cooldown_seconds = formData.auction_cooldown_seconds;
      if (formData.auction_ends_at !== initial.auction_ends_at)
        changes.auction_ends_at = formData.auction_ends_at
          ? fromDateTimeLocal(formData.auction_ends_at)
          : null;
    }

    if (formData.sendable && formData.codesText !== initial.codesText) {
      changes.codes = formData.codesText
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);
    }

    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const err = await response.json();
        alert(err.error || "Error actualizando producto");
      }
    } catch (error) {
      console.error("Error updating product:", error);
      alert("Error actualizando producto");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData(EMPTY_FORM);
    onClose();
  };

  // Una ronda cerrada o en espera no tiene fecha de fin: solo se exige a una
  // subasta abierta o recién activada.
  const endDateRequired =
    !product?.is_auction || product.auction_status === "in_progress";

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Editar Producto</DialogTitle>
          <DialogDescription>
            Modifica los datos del producto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Nombre</Label>
            <Input
              className="col-span-3"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Descripción</Label>
            <Input
              className="col-span-3"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Imagen URL</Label>
            <Input
              type="url"
              className="col-span-3"
              value={formData.image}
              onChange={(e) =>
                setFormData({ ...formData, image: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Precio</Label>
            <Input
              type="number"
              min={0}
              className="col-span-3"
              value={formData.price}
              onChange={(e) =>
                setFormData({ ...formData, price: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Stock</Label>
            <Input
              type="number"
              min={0}
              className="col-span-3"
              value={formData.stock}
              onChange={(e) =>
                setFormData({ ...formData, stock: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Modo Puja</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={formData.is_auction}
                onCheckedChange={(v) =>
                  setFormData({ ...formData, is_auction: Boolean(v) })
                }
              />
              <span className="text-sm">Activar subasta en tiempo real</span>
            </div>
          </div>

          {formData.is_auction && (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Incremento Mínimo</Label>
                <Input
                  type="number"
                  min={1}
                  className="col-span-3"
                  value={formData.min_bid_increment}
                  onChange={(e) =>
                    setFormData({ ...formData, min_bid_increment: e.target.value })
                  }
                  required
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Cooldown (seg)</Label>
                <Input
                  type="number"
                  min={10}
                  className="col-span-3"
                  value={formData.auction_cooldown_seconds}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      auction_cooldown_seconds: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Fin de Puja</Label>
                <Input
                  type="datetime-local"
                  className="col-span-3"
                  value={formData.auction_ends_at}
                  onChange={(e) =>
                    setFormData({ ...formData, auction_ends_at: e.target.value })
                  }
                  required={endDateRequired}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Enviable</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={formData.sendable}
                onCheckedChange={(v) =>
                  setFormData({ ...formData, sendable: Boolean(v) })
                }
              />
              <span className="text-sm">¿El producto envía códigos?</span>
            </div>
          </div>

          {formData.sendable && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right">Códigos (uno por línea)</Label>
              <textarea
                className="col-span-3 h-32 rounded-md border p-2"
                value={formData.codesText}
                onChange={(e) =>
                  setFormData({ ...formData, codesText: e.target.value })
                }
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={handleClose}>
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
