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
import { ProductRow } from "@/app/utils/products";

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  product: ProductRow | null;
}

export default function EditProductModal({
  isOpen,
  onClose,
  onSuccess,
  product,
}: EditProductModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    image: "",
    price: "",
    stock: "",
    sendable: false,
    codesText: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        description: product.description,
        image: product.image,
        price: product.price.toString(),
        stock: product.stock.toString(),
        sendable: product.sendable || false,
        codesText: (product.codes || []).join("\n"),
      });
    }
  }, [product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setIsLoading(true);

    try {
      const codes = formData.sendable
        ? formData.codesText
            .split("\n")
            .map((c) => c.trim())
            .filter(Boolean)
        : [];

      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          image: formData.image,
          price: formData.price,
          stock: formData.stock,
          sendable: formData.sendable,
          codes,
        }),
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
    setFormData({
      name: "",
      description: "",
      image: "",
      price: "",
      stock: "",
      sendable: false,
      codesText: "",
    });
    onClose();
  };

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
