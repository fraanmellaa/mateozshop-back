"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { AdminStats, StatsPeriod, StatsUnit } from "@/app/utils/stats";

const num = (value: number) => Math.round(value).toLocaleString("es-ES");

const day = (iso: string, withYear = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

/** «10 nov – 16 nov 2026» o «noviembre de 2026». */
function periodLabel(unit: StatsUnit, start: string, end: string) {
  if (unit === "month") {
    const text = new Date(`${start}T12:00:00Z`).toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return `${day(start)} – ${day(end, true)}`;
}

const EARNED: Array<{ key: keyof StatsPeriod["earned"]; label: string }> = [
  { key: "watch", label: "Ver el directo" },
  { key: "streak", label: "Racha" },
  { key: "rain", label: "Lluvias" },
  { key: "bigwin", label: "Big win" },
  { key: "maxwin", label: "Max win" },
  { key: "prediction", label: "Predicciones" },
  { key: "daily_box", label: "Cajas gratis" },
  { key: "ranking", label: "Ranking" },
];

const earnedTotal = (p: StatsPeriod) => EARNED.reduce((sum, item) => sum + p.earned[item.key], 0);
// Lo que sale de verdad de los saldos: en cajas y juegos, lo pagado menos lo devuelto.
const spentTotal = (p: StatsPeriod) =>
  p.spent.bids + p.spent.tickets + (p.spent.boxes_paid - p.spent.boxes_back) + (p.spent.games_bet - p.spent.games_back);

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-xs uppercase text-muted-foreground">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const th = "whitespace-nowrap p-3";
const thNum = "whitespace-nowrap p-3 text-right";
const td = "whitespace-nowrap p-3 font-medium";
const tdNum = "whitespace-nowrap p-3 text-right tabular-nums";

function Section({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{help}</p>
      {children}
    </section>
  );
}

export default function PageBody({
  weeks,
  months,
  error,
}: {
  weeks: AdminStats | null;
  months: AdminStats | null;
  error: string | null;
}) {
  const [unit, setUnit] = useState<StatsUnit>("week");

  if (error || !weeks || !months) {
    return (
      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        {error ?? "No hay números que enseñar."}
      </div>
    );
  }

  const stats = unit === "week" ? weeks : months;
  const label = (p: { start: string; end: string }) => periodLabel(unit, p.start, p.end);
  const first = <th className={th}>{unit === "week" ? "Semana" : "Mes"}</th>;
  const endOf = new Map(stats.periods.map((p) => [p.start, p.end]));

  return (
    <div className="mt-4 space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={unit === "week" ? "default" : "outline"} size="sm" onClick={() => setUnit("week")}>
          Por semana
        </Button>
        <Button variant={unit === "month" ? "default" : "outline"} size="sm" onClick={() => setUnit("month")}>
          Por mes
        </Button>
        <span className="text-sm text-muted-foreground">
          {unit === "week" ? "Semanas de lunes a domingo" : "Meses naturales"}, hora de Andorra. El periodo en
          curso va el primero y todavía no está cerrado.
        </span>
      </div>

      <Section
        title="Puntos repartidos"
        help="Puntos normales que han recibido los usuarios, por origen. «Ranking» junta el bonus del leaderboard mensual y el premio del ranking de TikTok."
      >
        <Table
          head={
            <tr>
              {first}
              {EARNED.map((item) => (
                <th key={item.key} className={thNum}>
                  {item.label}
                </th>
              ))}
              <th className={thNum}>Total</th>
            </tr>
          }
        >
          {stats.periods.map((p) => (
            <tr key={p.start} className="border-b last:border-0">
              <td className={td}>{label(p)}</td>
              {EARNED.map((item) => (
                <td key={item.key} className={tdNum}>
                  {num(p.earned[item.key])}
                </td>
              ))}
              <td className={`${tdNum} font-semibold`}>{num(earnedTotal(p))}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Puntos gastados"
        help="«Pujas» es lo pagado por los premios ya ganados (lo retenido en pujas abiertas no cuenta). En cajas de pago y juegos se ve lo pagado o apostado y lo que volvió a los usuarios; el total resta lo devuelto. «Otros» son ajustes a mano del panel y devoluciones: no entran en el total."
      >
        <Table
          head={
            <tr>
              {first}
              <th className={thNum}>Pujas</th>
              <th className={thNum}>Tickets</th>
              <th className={thNum}>Cajas: pagado</th>
              <th className={thNum}>Cajas: devuelto</th>
              <th className={thNum}>Juegos: apostado</th>
              <th className={thNum}>Juegos: devuelto</th>
              <th className={thNum}>Total gastado</th>
              <th className={thNum}>Otros</th>
            </tr>
          }
        >
          {stats.periods.map((p) => (
            <tr key={p.start} className="border-b last:border-0">
              <td className={td}>{label(p)}</td>
              <td className={tdNum}>{num(p.spent.bids)}</td>
              <td className={tdNum}>{num(p.spent.tickets)}</td>
              <td className={tdNum}>{num(p.spent.boxes_paid)}</td>
              <td className={tdNum}>{num(p.spent.boxes_back)}</td>
              <td className={tdNum}>{num(p.spent.games_bet)}</td>
              <td className={tdNum}>{num(p.spent.games_back)}</td>
              <td className={`${tdNum} font-semibold`}>{num(spentTotal(p))}</td>
              <td className={`${tdNum} text-muted-foreground`}>{num(p.other)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Premios"
        help="«Puestos» son las unidades dadas de alta en la tienda en ese periodo. «Vendidos» son los premios adjudicados, sin los pedidos cancelados. Salida y precio final suman solo los premios en puntos normales. «Personas con premio» cuenta a cada persona una vez, haya ganado en la tienda o en un sorteo."
      >
        <Table
          head={
            <tr>
              {first}
              <th className={thNum}>Puestos</th>
              <th className={thNum}>Vendidos</th>
              <th className={thNum}>De ellos, VIP</th>
              <th className={thNum}>Suma de salidas</th>
              <th className={thNum}>Suma de precios finales</th>
              <th className={thNum}>Personas con premio</th>
            </tr>
          }
        >
          {stats.periods.map((p) => (
            <tr key={p.start} className="border-b last:border-0">
              <td className={td}>{label(p)}</td>
              <td className={tdNum}>{num(p.prizes.listed)}</td>
              <td className={tdNum}>{num(p.prizes.sold)}</td>
              <td className={tdNum}>{num(p.prizes.vip_sold)}</td>
              <td className={tdNum}>{num(p.prizes.start_total)}</td>
              <td className={tdNum}>{num(p.prizes.final_total)}</td>
              <td className={tdNum}>{num(p.prizes.winners)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Premios vendidos, uno a uno"
        help="Precio final de cada premio frente a su salida. La salida es la que tiene hoy el premio en el panel."
      >
        {stats.sold.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            No se ha vendido ningún premio en este tiempo.
          </p>
        ) : (
          <Table
            head={
              <tr>
                {first}
                <th className={th}>Premio</th>
                <th className={th}>Ganador</th>
                <th className={thNum}>Salida</th>
                <th className={thNum}>Precio final</th>
                <th className={thNum}>Diferencia</th>
                <th className={th}>Pedido</th>
              </tr>
            }
          >
            {stats.sold.map((item) => {
              const diff = item.final_price - item.start_price;
              const pct = item.start_price > 0 ? Math.round((diff / item.start_price) * 100) : null;
              return (
                <tr key={item.order_id} className="border-b last:border-0">
                  <td className={td}>{periodLabel(unit, item.period, endOf.get(item.period) ?? item.period)}</td>
                  <td className="p-3">
                    {item.product}
                    {item.currency === "vip" && <span className="ml-2 text-xs text-muted-foreground">puntos VIP</span>}
                  </td>
                  <td className="p-3">{item.username ?? "—"}</td>
                  <td className={tdNum}>{num(item.start_price)}</td>
                  <td className={tdNum}>{num(item.final_price)}</td>
                  <td className={tdNum}>
                    {diff >= 0 ? "+" : "−"}
                    {num(Math.abs(diff))}
                    {pct !== null && <span className="ml-1 text-xs text-muted-foreground">({pct} %)</span>}
                  </td>
                  <td className="p-3">
                    <a href={`/orders/${item.order_id}`} className="underline underline-offset-2">
                      #{item.order_id}
                    </a>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </div>
  );
}
