/**
 * Conversión entre timestamps Unix (segundos) y los valores de los inputs
 * `datetime-local` / `date` / `time`, siempre en la hora local del navegador.
 * No usar `toISOString()` para rellenar esos inputs: devuelve UTC.
 */

/** Timestamp en segundos → "YYYY-MM-DDTHH:mm" en hora local. */
export function toDateTimeLocal(timestamp: number) {
  const d = new Date(timestamp * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/** "YYYY-MM-DDTHH:mm" (hora local) → timestamp en segundos. */
export function fromDateTimeLocal(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}
