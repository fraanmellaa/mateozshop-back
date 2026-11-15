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
import { toDateTimeLocal } from "@/app/utils/datetime";

const EMPTY_FORM = {
  name: "",
  description: "",
  image: "",
  price: "",
  stock: "",
  value_eur: "",
  delivery_type: "code",
  requires_trade_link: false,
  codesText: "",
};

function toForm(product: ProductRow): typeof EMPTY_FORM {
  return {
    name: product.name,
    description: product.description,
    image: product.image,
    price: String(product.price),
    stock: String(product.stock),
    value_eur: product.value_eur === null ? "" : String(product.value_eur),
    delivery_type: product.delivery_type,
    requires_trade_link: product.requires_trade_link,
    codesText: (product.codes || []).join("\n"),
  };
}

const STATUS_TEXT: Record<string, string> = {
  waiting: "Esperando la primera puja",
  in_progress: "En batalla",
  archived: "Sin stock (archivado)",
  finalizing: "Adjudicándose",
  cancelling: "Retirándose",
};

export default function EditProductModal({
  isOpen,
  onClose,
  onSuccess,
  product,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  product: ProductRow | null;
}) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (product) setFormData(toForm(product));
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    // Solo se envía lo que el admin ha cambiado: el stock y los códigos pueden
    // haber variado (adjudicaciones) desde que se cargó la página, y reenviarlos
    // los restauraría.
    const initial = toForm(product);
    const changes: Record<string, unknown> = {};

    if (formData.name !== initial.name) changes.name = formData.name;
    if (formData.description !== initial.description) changes.description = formData.description;
    if (formData.image !== initial.image) changes.image = formData.image;
    if (formData.price !== initial.price) changes.price = formData.price;
    if (formData.stock !== initial.stock) changes.stock = formData.stock;
    if (formData.value_eur !== initial.value_eur) changes.value_eur = formData.value_eur;
    if (formData.delivery_type !== initial.delivery_type) changes.delivery_type = formData.delivery_type;
    if (formData.requires_trade_link !== initial.requires_trade_link)
      changes.requires_trade_link = formData.requires_trade_link;
    if (formData.delivery_type === "code" && formData.codesText !== initial.codesText) {
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Editar Premio</DialogTitle>
          <DialogDescription>
            {product
              ? `${STATUS_TEXT[product.auction_status] ?? product.auction_status}${
                  product.auction_ends_at
                    ? ` · cierra ${toDateTimeLocal(product.auction_ends_at).replace("T", " ")}`
                    : ""
                }. El estado de la puja no se edita aquí.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Nombre</Label>
            <Input
              className="col-span-3"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Descripción</Label>
            <Input
              className="col-span-3"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Imagen URL</Label>
            <Input
              type="url"
              className="col-span-3"
              value={formData.image}
              onChange={(e) => setFormData({ ...formData, image: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Puja mínima (pts)</Label>
            <Input
              type="number"
              min={1}
              className="col-span-3"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
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
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Valor (€)</Label>
            <div className="col-span-3">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={formData.value_eur}
                onChange={(e) => setFormData({ ...formData, value_eur: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Si supera el umbral de revisión, el pedido se revisa a mano antes de entregarse.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Entrega</Label>
            <select
              className="col-span-3 flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={formData.delivery_type}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  delivery_type: e.target.value,
                  requires_trade_link: e.target.value === "trade" ? true : formData.requires_trade_link,
                })
              }
            >
              <option value="code">Código por email</option>
              <option value="dm">Mensaje privado</option>
              <option value="trade">Skin por intercambio de Steam</option>
            </select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Enlace de Steam</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={formData.requires_trade_link}
                disabled={formData.delivery_type === "trade"}
                onCheckedChange={(v) =>
                  setFormData({ ...formData, requires_trade_link: Boolean(v) })
                }
              />
              <span className="text-sm">Exigir enlace de intercambio de Steam para pujar</span>
            </div>
          </div>

          {formData.delivery_type === "code" && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right">Códigos (uno por línea)</Label>
              <textarea
                className="col-span-3 h-32 rounded-md border p-2"
                value={formData.codesText}
                onChange={(e) => setFormData({ ...formData, codesText: e.target.value })}
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
