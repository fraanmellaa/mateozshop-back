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
import { Checkbox } from "@/components/ui/checkbox";
import { PRODUCT_CATEGORIES } from "@/app/utils/products/categories";
import { PRODUCT_CURRENCIES } from "@/app/utils/products/currency";
import { fromDateTimeLocal } from "@/app/utils/datetime";

const EMPTY_FORM = {
  name: "",
  description: "",
  image: "",
  price: "",
  stock: "1",
  value_eur: "",
  delivery_type: "code",
  requires_trade_link: false,
  category: "",
  currency: "points",
  // «Disponible desde» como fecha y hora local ("" = sin fecha).
  available_from: "",
  counts_for_cap: true,
  codesText: "",
};

export default function CreateProductModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const codes =
        formData.delivery_type === "code"
          ? formData.codesText
              .split("\n")
              .map((c) => c.trim())
              .filter(Boolean)
          : [];

      const response = await fetch(`/api/admin/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          image: formData.image,
          price: formData.price,
          stock: formData.stock,
          value_eur: formData.value_eur,
          delivery_type: formData.delivery_type,
          requires_trade_link: formData.requires_trade_link,
          category: formData.category,
          // Solo se manda si es VIP: así se pueden crear premios aunque falte la 0032.
          ...(formData.currency === "vip" ? { currency: "vip" } : {}),
          // Igual con la fecha y el tope (migración 0039): solo si se han tocado.
          ...(formData.available_from ? { available_from: fromDateTimeLocal(formData.available_from) } : {}),
          ...(formData.counts_for_cap ? {} : { counts_for_cap: false }),
          codes,
        }),
      });

      if (response.ok) {
        setFormData(EMPTY_FORM);
        onSuccess();
      } else {
        const err = await response.json();
        alert(err.error || "Error creando producto");
      }
    } catch (error) {
      console.error("Error creating product:", error);
      alert("Error creando producto");
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
          <DialogTitle>Crear Premio</DialogTitle>
          <DialogDescription>
            El premio espera sin fecha de cierre hasta que alguien puje; la primera
            puja pone en marcha la cuenta atrás.
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
            <Label className="text-right">Precio de salida (pts)</Label>
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
              min={1}
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
            <Label className="text-right">Categoría</Label>
            <select
              className="col-span-3 flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              <option value="">Sin categoría (solo en «Todos»)</option>
              {PRODUCT_CATEGORIES.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Moneda</Label>
            <div className="col-span-3">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              >
                {PRODUCT_CURRENCIES.map((currency) => (
                  <option key={currency.key} value={currency.key}>
                    {currency.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Con puntos VIP solo pujan los usuarios verificados y el premio sale en «Verificados». El precio de salida es el de arriba, en puntos VIP.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Disponible desde</Label>
            <div className="col-span-3">
              <Input
                type="datetime-local"
                value={formData.available_from}
                onChange={(e) => setFormData({ ...formData, available_from: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {formData.currency === "vip"
                  ? "Fecha de apertura de este premio VIP: se puede pujar en el primer directo que haya desde esa fecha. Sin fecha, está cerrado."
                  : "Antes de esa fecha el premio se ve en la tienda con «Se abre el…» y no se puede pujar. Vacío = disponible ya."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Tope mensual</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={!formData.counts_for_cap}
                disabled={formData.currency === "vip"}
                onCheckedChange={(v) => setFormData({ ...formData, counts_for_cap: !v })}
              />
              <span className="text-sm">No cuenta para el tope de premios al mes</span>
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
              {isLoading ? "Creando..." : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
