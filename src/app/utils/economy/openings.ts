import { fairReserve } from "../fair";

import { EconomyError, rpc } from "./db";
import { rollDailyBox } from "./boxes";
import { getEconomySettings } from "./settings";
import { getUserEconomy } from "./user";

export type BoxPrize = {
  tier: string;
  kind: "points" | "item";
  name: string;
  points: number;
  fallback: boolean;
};

export type BoxResult = {
  prize: BoxPrize;
  balance: number;
  fair: { server_seed_hash: string; client_seed: string; nonce: number };
};

type DailyRpc = {
  tier: string;
  kind: "points" | "item";
  name: string;
  points: number;
  fallback: boolean;
  balance: number;
};

/**
 * Abre la caja diaria (solo puntos). El tramo sale de utils/fair con un nonce
 * reservado; la comprobación definitiva (una por día de directo, minutos
 * vistos) y el abono se hacen atómicamente en SQL. Si dos peticiones
 * compiten, solo una cobra: la otra recibe DAILY_BOX_NOT_AVAILABLE.
 */
export async function openDailyBox(userId: number): Promise<BoxResult> {
  const settings = await getEconomySettings();

  // Comprobación barata antes de gastar un nonce.
  const status = await getUserEconomy(userId);
  if (!status.dailyBox.available) throw new EconomyError("DAILY_BOX_NOT_AVAILABLE", 409);

  const reservation = await fairReserve(userId, 1);
  const roll = rollDailyBox(
    settings.dailyBox.tiers,
    reservation.server_seed,
    reservation.client_seed,
    reservation.nonce_start
  );

  // La caja diaria solo da puntos.
  const tier = roll.tier;
  const name = `${roll.points} puntos`;

  const result = await rpc<DailyRpc>("economy_open_daily_box", {
    p_user_id: userId,
    p_box_minutes: settings.minutes.dailyBox,
    p_tier_id: tier.id,
    p_kind: "points",
    p_name: name,
    p_points: roll.points,
    p_item_stock: 0,
    p_fallback_points: 0,
    p_server_seed_hash: reservation.server_seed_hash,
    p_client_seed: reservation.client_seed,
    p_nonce: reservation.nonce_start,
    p_roll: { basisPoint: roll.basisPoint, points: roll.points },
  });

  return {
    prize: {
      tier: result.tier,
      kind: result.kind,
      name: result.fallback ? `${result.points} puntos` : result.name,
      points: result.points,
      fallback: result.fallback,
    },
    balance: result.balance,
    fair: {
      server_seed_hash: reservation.server_seed_hash,
      client_seed: reservation.client_seed,
      nonce: reservation.nonce_start,
    },
  };
}
