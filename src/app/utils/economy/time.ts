/** Hora de Andorra: todos los "día" y "mes" de la economía. */

const TZ = "Europe/Andorra";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export type AdParts = { year: number; month: number; day: number; hour: number };

export function adParts(ms: number = Date.now()): AdParts {
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM' (hora de Andorra). */
export function adMonth(ms: number = Date.now()): string {
  const p = adParts(ms);
  return `${p.year}-${pad(p.month)}`;
}

/** 'YYYY-MM-DD' (hora de Andorra). */
export function adDay(ms: number = Date.now()): string {
  const p = adParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
