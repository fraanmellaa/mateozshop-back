import { rpc } from "./db";
import { isResetBlocking } from "./monthly";
import type { RainKind } from "./schema";
import { getEconomySettings } from "./settings";

export type GrantRainInput = {
  kind: RainKind;
  issuer: { platform: "kick" | "twitch"; platformUserId: string };
  /** Id del mensaje del webhook: un reintento con el mismo id no paga dos veces. */
  eventId?: string;
};

export type GrantRainResult = {
  ok: boolean;
  reason?: "LIMIT_REACHED" | "NOT_LIVE" | "DISABLED";
  recipients?: number;
  points?: number;
};

type RainRpc = {
  ok: boolean;
  reason?: "LIMIT_REACHED" | "NOT_LIVE";
  recipients?: number;
  points?: number;
};

/**
 * Reparte un evento (lluvia, big win o max win) entre quienes escribieron en el
 * chat dentro de la ventana ANTERIOR al comando (una vez por usuario aunque esté
 * en Kick y Twitch; sin baneados). Escribir después del comando no cuenta.
 * Comprueba directo abierto y el máximo por directo. Todo ocurre en una
 * transacción SQL (economy_grant_rain).
 */
export async function grantRain(input: GrantRainInput): Promise<GrantRainResult> {
  const settings = await getEconomySettings();
  const rain = settings.rain[input.kind];
  if (!rain || rain.points < 1 || rain.maxPerStream < 1) {
    return { ok: false, reason: "DISABLED" };
  }
  // Durante el reinicio mensual no se reparte nada que el reinicio fuera a borrar.
  if (await isResetBlocking()) return { ok: false, reason: "DISABLED" };

  const result = await rpc<RainRpc>("economy_grant_rain", {
    p_kind: input.kind,
    p_points: rain.points,
    p_window_seconds: rain.windowMinutes * 60,
    p_max: rain.maxPerStream,
    p_issuer_platform: input.issuer.platform,
    p_issuer_id: input.issuer.platformUserId,
    p_event_id: input.eventId ?? null,
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, recipients: result.recipients ?? 0, points: result.points ?? rain.points };
}
