/** País que se asume cuando no se conoce el del visitante. */
export const DEFAULT_COUNTRY = "ES";

/**
 * Zonas rápidas del panel de Bonos: cada una añade sus países de golpe. El
 * casino solo sale en los países que tenga puestos (nada está fijo en código).
 */
export const COUNTRY_GROUPS: { label: string; codes: string[] }[] = [
  { label: "España", codes: ["ES"] },
  { label: "Andorra", codes: ["AD"] },
  {
    label: "Latinoamérica",
    codes: ["AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "UY", "VE"],
  },
];

const COUNTRY_NAMES: Record<string, string> = {
  ES: "España",
  AD: "Andorra",
  PT: "Portugal",
  FR: "Francia",
  MX: "México",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  PE: "Perú",
};

/** "ES, AD, MX" -> "España, Andorra, México"; los grupos completos se nombran juntos. */
export function countriesText(codes: string[]): string {
  const rest = new Set(codes);
  const parts: string[] = [];
  for (const group of COUNTRY_GROUPS) {
    if (group.codes.length > 1 && group.codes.every((code) => rest.has(code))) {
      parts.push(group.label);
      group.codes.forEach((code) => rest.delete(code));
    }
  }
  for (const code of codes) if (rest.has(code)) parts.push(COUNTRY_NAMES[code] ?? code);
  return parts.join(", ");
}
