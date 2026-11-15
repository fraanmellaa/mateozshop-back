const DAY_SECONDS = 86400;

/**
 * ¿Alguna de las cuentas vinculadas tiene al menos `minDays` días? Twitch usa su
 * fecha de creación (Helix); Kick no la expone, así que se usa la de vinculación.
 * Sin ninguna cuenta vinculada devuelve false.
 */
export function isAccountOldEnough(
  user: { twitch_created_at: number | null; kick_linked_at: number | null },
  minDays: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  const limit = nowSec - Math.max(0, minDays) * DAY_SECONDS;
  return [user.twitch_created_at, user.kick_linked_at].some(
    (at) => typeof at === "number" && at > 0 && at <= limit
  );
}
