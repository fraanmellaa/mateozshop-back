const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Andorra",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de Andorra ('YYYY-MM-DD') de un timestamp Unix en segundos (equivale a `ad_day` en SQL). */
export function andorraDay(ts: number = Math.floor(Date.now() / 1000)): string {
  return dayFormatter.format(new Date(ts * 1000));
}
