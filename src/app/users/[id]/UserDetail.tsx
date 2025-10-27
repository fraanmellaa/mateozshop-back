"use client";

import { User } from "@/app/utils/users/types";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  User as UserIcon,
  Mail,
  Calendar,
  Trophy,
  CreditCard,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface UserDetailProps {
  user: User;
}

export default function UserDetail({ user }: UserDetailProps) {
  const router = useRouter();
  const userDate = new Date(user.created_at);

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
      </div>

      {/* Información principal del usuario */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-6">
          <Image
            src={user.image}
            alt={user.username}
            width={120}
            height={120}
            className="rounded-full"
          />
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {user.username}
            </h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground">{user.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground">
                  Registro: {userDate.toLocaleDateString("es-ES")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Información de cuentas */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Información de Cuentas
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Discord ID
            </label>
            <p className="text-lg font-mono text-foreground">
              {user.discord_id}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Kick ID
            </label>
            <p className="text-lg font-mono text-foreground">
              {user.kick_id || "No vinculado"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Código de Verificación
            </label>
            <p className="text-lg font-mono text-foreground">
              {user.verification_code}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              ID de Usuario
            </label>
            <p className="text-lg font-mono text-foreground">#{user.id}</p>
          </div>
        </div>
      </div>

      {/* Estadísticas de puntos */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Estadísticas de Puntos
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-blue-500/20 rounded-lg">
            <CreditCard className="h-8 w-8 text-blue-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              Total de Puntos
            </p>
            <p className="text-2xl font-bold text-blue-400">
              {user.total_points}
            </p>
          </div>
          <div className="text-center p-4 bg-red-500/20 rounded-lg">
            <CreditCard className="h-8 w-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              Puntos Usados
            </p>
            <p className="text-2xl font-bold text-red-400">
              {user.used_points}
            </p>
          </div>
          <div className="text-center p-4 bg-green-500/20 rounded-lg">
            <CreditCard className="h-8 w-8 text-green-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              Puntos Disponibles
            </p>
            <p className="text-2xl font-bold text-green-400">
              {user.actual_points}
            </p>
          </div>
        </div>
      </div>

      {/* Acciones rápidas */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Acciones Rápidas
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/orders?user=${encodeURIComponent(user.username)}`)
            }
            className="flex items-center gap-2"
          >
            <CreditCard className="h-4 w-4" />
            Ver Pedidos
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/api/user/${user.discord_id}/giveaways`)
            }
            className="flex items-center gap-2"
          >
            <Trophy className="h-4 w-4" />
            Ver Sorteos
          </Button>
        </div>
      </div>

      {/* Información adicional */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Información Adicional
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Fecha de Registro
            </label>
            <p className="text-lg text-foreground">
              {userDate.toLocaleDateString("es-ES", {
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
              Estado de la Cuenta
            </label>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300">
              Activa
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
