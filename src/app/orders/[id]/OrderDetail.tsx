"use client";

import { useEffect, useState } from "react";
import { OrderDetail as OrderDetailType } from "@/app/utils/orders/types";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  User,
  Package,
  Calendar,
  CreditCard,
  Settings,
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ChangeOrderStatusModal from "./ChangeOrderStatusModal";
import SendEmailModal from "./SendEmailModal";
import ReviewOrderModal from "../ReviewOrderModal";
import {
  resendOrderCode,
  sendOrderEmail,
  updateOrderStatus,
} from "@/app/utils/orders/actions";
import { toast } from "sonner";

interface OrderDetailProps {
  order: OrderDetailType;
}

export default function OrderDetail({ order }: OrderDetailProps) {
  const router = useRouter();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState(order);

  // Tras router.refresh() llega el pedido actualizado desde el servidor.
  useEffect(() => setCurrentOrder(order), [order]);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [review, setReview] = useState<{ approve: boolean } | null>(null);

  const pendingReview =
    currentOrder.needs_review && !currentOrder.reviewed_at && currentOrder.status !== 2;
  const deliveryLabel =
    currentOrder.product.delivery_type === "code"
      ? "Código por email"
      : currentOrder.product.delivery_type === "trade"
        ? "Intercambio de Steam"
        : "Mensaje privado";

  const handleStatusChange = async (newStatus: number) => {
    try {
      const result = await updateOrderStatus(currentOrder.id, newStatus);
      if (result.success) {
        setCurrentOrder({ ...currentOrder, status: newStatus });
        if ("warning" in result && result.warning) {
          toast.warning(result.warning);
        } else {
          toast.success(
            newStatus === 2
              ? "Pedido cancelado y puntos devueltos al usuario"
              : "Estado del pedido actualizado correctamente"
          );
        }
        router.refresh();
      } else {
        toast.error(result.error || "Error al actualizar el estado");
      }
    } catch {
      toast.error("Error al actualizar el estado del pedido");
    }
  };

  const handleSendEmail = async (subject: string, message: string) => {
    try {
      const result = await sendOrderEmail(currentOrder.id, subject, message);
      if (result.success) {
        toast.success("Email enviado correctamente");
      } else {
        toast.error(result.error || "Error al enviar el email");
      }
    } catch {
      toast.error("Error al enviar el email");
    }
  };

  const handleResendCode = async () => {
    setIsResendingCode(true);
    try {
      const result = await resendOrderCode(currentOrder.id);
      if (result.success) {
        setCurrentOrder({ ...currentOrder, code_email_sent: true });
        toast.success("Código reenviado correctamente");
      } else {
        toast.error(result.error || "Error al reenviar el código");
      }
    } catch {
      toast.error("Error al reenviar el código");
    } finally {
      setIsResendingCode(false);
    }
  };

  const getStatusInfo = (status: number) => {
    switch (status) {
      case 0:
        return {
          text: "Pendiente",
          color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
          description: "El pedido está pendiente de procesamiento",
        };
      case 1:
        return {
          text: "Completada",
          color: "bg-green-500/20 text-green-300 border-green-500/30",
          description: "El pedido ha sido completado exitosamente",
        };
      case 2:
        return {
          text: "Cancelada",
          color: "bg-red-500/20 text-red-300 border-red-500/30",
          description: "El pedido ha sido cancelado",
        };
      default:
        return {
          text: "Desconocido",
          color: "bg-gray-500/20 text-gray-300 border-gray-500/30",
          description: "Estado desconocido",
        };
    }
  };

  const statusInfo = getStatusInfo(currentOrder.status);
  const orderDate = new Date(currentOrder.created_at);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header con botón de regreso */}
      <div className="flex items-center justify-between mt-4">
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium border ${statusInfo.color}`}
          >
            {statusInfo.text}
          </span>
        </div>
      </div>

      {/* Información general del pedido */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Información del Pedido
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              ID del Pedido
            </label>
            <p className="text-lg font-mono text-foreground">
              #{currentOrder.id}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Fecha de Creación
            </label>
            <p className="text-lg text-foreground">
              {orderDate.toLocaleDateString("es-ES", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Total
            </label>
            <p className="text-lg font-semibold text-foreground">
              {currentOrder.total} puntos
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 bg-muted/50 rounded-md">
          <p className="text-sm text-muted-foreground">
            {statusInfo.description}
          </p>
        </div>
      </div>

      {/* Información del usuario */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Información del Usuario
          </h2>
        </div>

        <div className="flex items-start gap-4">
          <Image
            src={currentOrder.user.image}
            alt={currentOrder.user.username}
            width={64}
            height={64}
            className="rounded-full"
          />
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Nombre de Usuario
              </label>
              <p className="text-lg text-foreground">
                {currentOrder.user.username}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Email
              </label>
              <p className="text-lg text-foreground">
                {currentOrder.user.email}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Discord ID
              </label>
              <p className="text-lg font-mono text-foreground">
                {currentOrder.user.discord_id}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Kick ID
              </label>
              <p className="text-lg font-mono text-foreground">
                {currentOrder.user.kick_id || "No disponible"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => router.push(`/users/${currentOrder.user.id}`)}
            className="flex items-center gap-2"
          >
            <User className="h-4 w-4" />
            Ver perfil completo del usuario
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-3 bg-muted/30 rounded-md">
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Total de Puntos
            </p>
            <p className="text-lg font-semibold text-blue-400">
              {currentOrder.user.total_points}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Puntos Usados
            </p>
            <p className="text-lg font-semibold text-red-400">
              {currentOrder.user.used_points}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Puntos Disponibles
            </p>
            <p className="text-lg font-semibold text-green-400">
              {currentOrder.user.available_points}
            </p>
          </div>
        </div>
      </div>

      {/* Información del producto */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Producto</h2>
        </div>

        <div className="flex items-start gap-6">
          <Image
            src={currentOrder.product.image}
            alt={currentOrder.product.name}
            width={120}
            height={120}
            className="rounded-lg object-cover"
          />
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {currentOrder.product.name}
              </h3>
              <p className="text-muted-foreground mt-1">
                {currentOrder.product.description}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Precio
                </label>
                <p className="text-lg font-semibold text-foreground">
                  {currentOrder.product.price} puntos
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Stock Disponible
                </label>
                <p className="text-lg text-foreground">
                  {currentOrder.product.stock} unidades
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Envío
                </label>
                <p className="text-lg text-foreground">{deliveryLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Entrega y revisión */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Entrega y revisión</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Tipo de entrega</label>
            <p className="text-lg text-foreground">{deliveryLabel}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Valor del premio</label>
            <p className="text-lg text-foreground">
              {currentOrder.product.value_eur === null ? "—" : `${currentOrder.product.value_eur} €`}
            </p>
          </div>
          {currentOrder.product.delivery_type === "trade" && (
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">
                Enlace de intercambio de Steam del ganador
              </label>
              {currentOrder.user.steam_trade_url ? (
                <p className="text-sm font-mono break-all">
                  <a
                    href={currentOrder.user.steam_trade_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline"
                  >
                    {currentOrder.user.steam_trade_url}
                  </a>
                </p>
              ) : (
                <p className="text-sm text-red-300">El ganador no ha guardado su enlace de Steam.</p>
              )}
            </div>
          )}
        </div>

        {currentOrder.needs_review && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md">
            {pendingReview ? (
              <>
                <p className="text-sm text-yellow-300">
                  Premio de más de la cifra de revisión: no se entrega hasta que lo apruebes.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => setReview({ approve: true })}>Aprobar</Button>
                  <Button variant="destructive" onClick={() => setReview({ approve: false })}>
                    Rechazar y devolver puntos
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {currentOrder.reviewed_at
                  ? `Revisado por ${currentOrder.reviewed_by ?? "—"} el ${new Date(
                      currentOrder.reviewed_at
                    ).toLocaleDateString("es-ES", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Requería revisión."}
                {currentOrder.review_note ? ` Nota: ${currentOrder.review_note}` : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Código entregado */}
      {currentOrder.delivered_code && (
        <div className="bg-card rounded-lg border border-border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Código entregado
            </h2>
          </div>

          <p className="text-lg font-mono text-foreground break-all">
            {currentOrder.delivered_code}
          </p>

          {pendingReview && (
            <p className="mt-2 text-sm text-muted-foreground">
              Código reservado: no se envía hasta aprobar el pedido.
            </p>
          )}

          {currentOrder.code_email_sent === false && (
            <div className="mt-4 p-3 bg-red-500/20 rounded-md">
              <p className="text-sm text-red-300">
                El email con el código no se pudo enviar. Reenvíalo para que el
                usuario lo reciba.
              </p>
            </div>
          )}

          <div className="mt-4">
            <Button
              variant="outline"
              onClick={handleResendCode}
              disabled={isResendingCode || pendingReview}
              className="flex items-center gap-2"
            >
              <Mail className="h-4 w-4" />
              {isResendingCode ? "Enviando..." : "Reenviar código por email"}
            </Button>
          </div>
        </div>
      )}

      {/* Acciones de Administrador */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Acciones de Administrador
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            onClick={() => setIsStatusModalOpen(true)}
            variant="outline"
            className="flex items-center gap-2 h-12"
            disabled={currentOrder.status === 2 || pendingReview}
            title={
              currentOrder.status === 2
                ? "Un pedido cancelado no se puede reabrir"
                : pendingReview
                  ? "Aprueba o rechaza primero la revisión"
                  : undefined
            }
          >
            <Settings className="h-4 w-4" />
            Cambiar Estado del Pedido
          </Button>

          <Button
            onClick={() => setIsEmailModalOpen(true)}
            variant="outline"
            className="flex items-center gap-2 h-12"
          >
            <Mail className="h-4 w-4" />
            Enviar Email al Usuario
          </Button>
        </div>
      </div>

      {/* Timeline del pedido */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Historial del Pedido
          </h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-md">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <div>
              <p className="font-medium text-foreground">Pedido creado</p>
              <p className="text-sm text-muted-foreground">
                {orderDate.toLocaleDateString("es-ES", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          {currentOrder.status === 1 && (
            <div className="flex items-center gap-3 p-3 bg-green-500/20 rounded-md">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <div>
                <p className="font-medium text-foreground">Pedido completado</p>
                <p className="text-sm text-muted-foreground">
                  Estado actualizado
                </p>
              </div>
            </div>
          )}

          {currentOrder.status === 2 && (
            <div className="flex items-center gap-3 p-3 bg-red-500/20 rounded-md">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <div>
                <p className="font-medium text-foreground">Pedido cancelado</p>
                <p className="text-sm text-muted-foreground">
                  Puntos devueltos al usuario
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modales */}
      <ReviewOrderModal
        orderId={currentOrder.id}
        approve={review?.approve ?? true}
        isOpen={review !== null}
        onClose={() => setReview(null)}
        onDone={() => {
          setReview(null);
          router.refresh();
        }}
      />

      <ChangeOrderStatusModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={handleStatusChange}
        currentStatus={currentOrder.status}
        orderId={currentOrder.id}
      />

      <SendEmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        onSend={handleSendEmail}
        userEmail={currentOrder.user.email}
        userName={currentOrder.user.username}
      />
    </div>
  );
}
