import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isMissingFunction } from "@/app/utils/products/currency";

/**
 * Números del panel (función SQL `admin_stats`, migración 0040): una fila por
 * semana o por mes con los puntos repartidos por origen, los gastados por
 * destino y los premios puestos y vendidos. Todo en hora de Andorra.
 */

export type StatsUnit = "week" | "month";

export type StatsPeriod = {
  /** Primer y último día del periodo (YYYY-MM-DD). */
  start: string;
  end: string;
  /** Puntos repartidos, por origen. */
  earned: {
    watch: number;
    streak: number;
    rain: number;
    bigwin: number;
    maxwin: number;
    prediction: number;
    daily_box: number;
    ranking: number;
  };
  /** Puntos gastados, por destino. En cajas de pago y juegos, lo pagado y lo devuelto. */
  spent: {
    bids: number;
    tickets: number;
    boxes_paid: number;
    boxes_back: number;
    games_bet: number;
    games_back: number;
  };
  /** Otros movimientos (ajustes a mano del panel, devoluciones). No incluye el reinicio mensual. */
  other: number;
  prizes: {
    /** Unidades de premios dadas de alta en el periodo. */
    listed: number;
    /** Premios adjudicados (pedidos sin cancelar), en puntos normales o VIP. */
    sold: number;
    /** De los vendidos en puntos normales: suma de sus salidas y de sus precios finales. */
    start_total: number;
    final_total: number;
    vip_sold: number;
    /** Personas distintas con algún premio (tienda o sorteo). */
    winners: number;
  };
};

export type StatsSoldPrize = {
  order_id: number;
  /** Periodo al que pertenece (su primer día). */
  period: string;
  created_at: number;
  product: string;
  currency: "points" | "vip";
  start_price: number;
  final_price: number;
  username: string | null;
};

export type AdminStats = {
  unit: StatsUnit;
  periods: StatsPeriod[];
  sold: StatsSoldPrize[];
};

export const STATS_MIGRATION_ERROR =
  "Para ver los números falta aplicar la migración 0040 (0040_audit_stats.sql) en Supabase";

/** Periodos que se enseñan por defecto: 12 semanas y 12 meses. */
export const DEFAULT_STATS_PERIODS = 12;
export const MAX_STATS_PERIODS = 60;

/** null si la migración 0040 todavía no está aplicada. */
export async function getAdminStats(unit: StatsUnit, periods = DEFAULT_STATS_PERIODS): Promise<AdminStats | null> {
  const count = Math.min(Math.max(Math.trunc(periods) || DEFAULT_STATS_PERIODS, 1), MAX_STATS_PERIODS);
  const { data, error } = await getSupabaseAdmin().rpc("admin_stats", { p_unit: unit, p_periods: count });
  if (error) {
    if (isMissingFunction(error, "admin_stats")) return null;
    throw error;
  }
  return data as AdminStats;
}
