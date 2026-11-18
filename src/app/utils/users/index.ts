import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { creditPoints, resetPoints, revokePoints } from "@/app/utils/points";
import { creditVip, revokeVip, setUserVerified } from "@/app/utils/points/vip";
import { User } from "./types";

export type { User };

const UNIQUE_VIOLATION = "23505";

type DbError = { code?: string; message?: string; details?: string | null };

function violates(error: DbError, column: string) {
  return (
    error.code === UNIQUE_VIOLATION &&
    `${error.message || ""} ${error.details || ""}`.includes(column)
  );
}

function mapUserRow(user: Record<string, unknown>) {
  return {
    ...user,
    is_banned: Boolean(user.is_banned),
    is_verified: Boolean(user.is_verified),
    verified_casinos: Number(user.verified_casinos || 0),
    vip_points: Number(user.vip_points || 0),
    actual_points:
      Number(user.total_points || 0) - Number(user.used_points || 0),
    created_at: new Date(Number(user.created_at || 0) * 1000).toISOString(),
  } as User;
}

/** Campos que se devuelven al front (contrato de /api/user). */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    image: user.image,
    actual_points: user.actual_points,
    kick_id: user.kick_id ?? null,
    kick_username: user.kick_username ?? null,
    kick_linked_at: user.kick_linked_at ?? null,
    twitch_id: user.twitch_id ?? null,
    twitch_username: user.twitch_username ?? null,
    twitch_linked_at: user.twitch_linked_at ?? null,
    steam_trade_url: user.steam_trade_url ?? null,
    adult_confirmed: Boolean(user.adult_confirmed_at),
    is_banned: Boolean(user.is_banned),
    is_verified: Boolean(user.is_verified),
    verified_casinos: Number(user.verified_casinos || 0),
    vip_points: Number(user.vip_points || 0),
  };
}

export const getUsers = async () => {
  const { data: usersData, error } = await getSupabaseAdmin()
    .from("users")
    .select("*");
  if (error) {
    throw error;
  }

  const usersArray: User[] = (usersData || []).map((user) => mapUserRow(user));

  return usersArray;
};

export const getUserByDiscordId = async (discordId: string) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("discord_id", discordId)
    .limit(1);
  if (error) {
    throw error;
  }

  return data?.[0] ? mapUserRow(data[0]) : null;
};

export const getUserByKickId = async (kickId: string) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("kick_id", kickId)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] ? mapUserRow(data[0]) : null;
};

export const getUserByTwitchId = async (twitchId: string) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("twitch_id", twitchId)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] ? mapUserRow(data[0]) : null;
};

export const getUserById = async (userId: number) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("id", userId)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] ? mapUserRow(data[0]) : null;
};

// Los cambios de saldo van siempre por utils/points (funciones SQL atómicas
// con registro). Lanzan PointsError (USER_NOT_FOUND, INSUFFICIENT_POINTS...).

export const addPointsToUserById = async (userId: number, amount: number) => {
  await creditPoints(userId, amount, { kind: "admin_add" });
  return getUserById(userId);
};

export const removeAvailablePointsFromUserById = async (
  userId: number,
  amount: number
) => {
  await revokePoints(userId, amount, { kind: "admin_remove" });
  return getUserById(userId);
};

// Puntos VIP y verificación (migración 0032). Lanzan VipUnavailableError si la
// migración no está aplicada.

export const setUserVerifiedById = async (userId: number, verified: boolean, admin: string) => {
  const found = await setUserVerified(userId, verified, admin);
  return found ? getUserById(userId) : null;
};

export const addVipPointsToUserById = async (userId: number, amount: number) => {
  await creditVip(userId, amount, { kind: "admin_add" });
  return getUserById(userId);
};

export const removeVipPointsFromUserById = async (userId: number, amount: number) => {
  await revokeVip(userId, amount, { kind: "admin_remove" });
  return getUserById(userId);
};

export const resetUserPointsById = async (userId: number) => {
  await resetPoints(userId);
  return getUserById(userId);
};

export const setUserBannedStatusById = async (
  userId: number,
  isBanned: boolean
) => {
  const { data: updatedRows, error } = await getSupabaseAdmin()
    .from("users")
    .update({ is_banned: isBanned })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (error) throw error;

  return updatedRows?.[0] ? mapUserRow(updatedRows[0]) : null;
};

/**
 * Alta o actualización del usuario al iniciar sesión con Discord.
 * `username` es UNIQUE en BD pero el nombre visible de Discord no lo es: si
 * choca se guarda con un sufijo sacado del discord_id.
 * Lanza Error("EMAIL_ALREADY_REGISTERED") si el email ya es de otra cuenta y
 * Error("ADULT_CONFIRMATION_REQUIRED") si es un usuario nuevo sin confirmar +18.
 * Un usuario existente que aún no había confirmado puede hacerlo aquí.
 */
export const createUser = async (user: {
  name: string;
  user_id: string;
  profile_picture: string;
  email: string;
  adult_confirmed?: boolean;
  terms_accepted?: boolean;
}) => {
  const supabase = getSupabaseAdmin();
  const discordId = user.user_id.toString();
  const fallbackNames = [
    `${user.name}_${discordId.slice(-4)}`,
    `${user.name}_${discordId}`,
  ];

  const existing = await getUserByDiscordId(discordId);
  const nowSec = Math.floor(Date.now() / 1000);

  if (!existing && user.adult_confirmed !== true) {
    throw new Error("ADULT_CONFIRMATION_REQUIRED");
  }

  if (existing) {
    if (user.adult_confirmed === true && !existing.adult_confirmed_at) {
      await confirmAdult(existing.id, user.terms_accepted === true);
      existing.adult_confirmed_at = nowSec;
      if (user.terms_accepted === true) existing.terms_accepted_at = nowSec;
    }

    const nameChanged =
      existing.username !== user.name &&
      !fallbackNames.includes(existing.username);
    const imageChanged = existing.image !== user.profile_picture;

    if (!nameChanged && !imageChanged) return existing;

    // Si el nombre nuevo ya lo tiene otro, se conserva el actual.
    const attempts: Record<string, string>[] = nameChanged
      ? [
          { username: user.name, image: user.profile_picture },
          { image: user.profile_picture },
        ]
      : [{ image: user.profile_picture }];

    for (const changes of attempts) {
      const { data, error } = await supabase
        .from("users")
        .update(changes)
        .eq("id", existing.id)
        .select("*")
        .limit(1);

      if (!error) return data?.[0] ? mapUserRow(data[0]) : existing;
      if (!violates(error, "username")) throw error;
    }

    return existing;
  }

  for (const username of [user.name, ...fallbackNames]) {
    const { data, error } = await supabase
      .from("users")
      .insert({
        username,
        discord_id: discordId,
        kick_id: null,
        image: user.profile_picture,
        email: user.email,
        total_points: 0,
        used_points: 0,
        created_at: nowSec,
        adult_confirmed_at: nowSec,
        terms_accepted_at: user.terms_accepted === true ? nowSec : null,
      })
      .select("*")
      .limit(1);

    if (!error) return data?.[0] ? mapUserRow(data[0]) : null;

    if (violates(error, "username")) continue;
    // Dos altas a la vez del mismo usuario: la otra ya lo ha creado.
    if (violates(error, "discord_id")) return getUserByDiscordId(discordId);
    if (violates(error, "email")) throw new Error("EMAIL_ALREADY_REGISTERED");
    throw error;
  }

  throw new Error("USERNAME_UNAVAILABLE");
};

export type KickLinkErrorCode =
  | "KICK_ALREADY_LINKED"
  | "KICK_ACCOUNT_ALREADY_LINKED";

export class KickLinkError extends Error {
  code: KickLinkErrorCode;

  constructor(code: KickLinkErrorCode) {
    super(code);
    this.name = "KickLinkError";
    this.code = code;
  }
}

/**
 * Vincula una cuenta de Kick. Solo si el usuario no tiene ya una
 * (KICK_ALREADY_LINKED) y esa cuenta no es de otro usuario
 * (KICK_ACCOUNT_ALREADY_LINKED, por el índice único de `kick_id`).
 * Devuelve null si el usuario no existe.
 */
export const linkKickAccount = async (
  userId: number,
  kickId: string,
  kickUsername: string
) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .update({
      kick_id: kickId,
      kick_username: kickUsername,
      kick_linked_at: Math.floor(Date.now() / 1000),
    })
    .eq("id", userId)
    .is("kick_id", null)
    .select("*")
    .limit(1);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new KickLinkError("KICK_ACCOUNT_ALREADY_LINKED");
    }
    throw error;
  }

  if (data?.[0]) return mapUserRow(data[0]);

  const current = await getUserById(userId);
  if (current?.kick_id) throw new KickLinkError("KICK_ALREADY_LINKED");
  return null;
};

export const unlinkKickAccount = async (userId: number) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .update({ kick_id: null, kick_username: null, kick_linked_at: null })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (error) throw error;

  return data?.[0] ? mapUserRow(data[0]) : null;
};

export type TwitchLinkErrorCode =
  | "TWITCH_ALREADY_LINKED"
  | "TWITCH_ACCOUNT_ALREADY_LINKED";

export class TwitchLinkError extends Error {
  code: TwitchLinkErrorCode;

  constructor(code: TwitchLinkErrorCode) {
    super(code);
    this.name = "TwitchLinkError";
    this.code = code;
  }
}

/**
 * Vincula una cuenta de Twitch (con su fecha de creación de Helix). Solo si el
 * usuario no tiene ya una (TWITCH_ALREADY_LINKED) y esa cuenta no es de otro
 * usuario (TWITCH_ACCOUNT_ALREADY_LINKED, por el índice único de `twitch_id`).
 * Devuelve null si el usuario no existe.
 */
export const linkTwitchAccount = async (
  userId: number,
  twitch: { id: string; username: string; createdAt: number | null }
) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .update({
      twitch_id: twitch.id,
      twitch_username: twitch.username,
      twitch_created_at: twitch.createdAt,
      twitch_linked_at: Math.floor(Date.now() / 1000),
    })
    .eq("id", userId)
    .is("twitch_id", null)
    .select("*")
    .limit(1);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new TwitchLinkError("TWITCH_ACCOUNT_ALREADY_LINKED");
    }
    throw error;
  }

  if (data?.[0]) return mapUserRow(data[0]);

  const current = await getUserById(userId);
  if (current?.twitch_id) throw new TwitchLinkError("TWITCH_ALREADY_LINKED");
  return null;
};

export const unlinkTwitchAccount = async (userId: number) => {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .update({
      twitch_id: null,
      twitch_username: null,
      twitch_created_at: null,
      twitch_linked_at: null,
    })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (error) throw error;

  return data?.[0] ? mapUserRow(data[0]) : null;
};

/** Marca al usuario como mayor de edad (y, si se indica, con los términos aceptados). */
export const confirmAdult = async (userId: number, termsAccepted: boolean) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .update({
      adult_confirmed_at: nowSec,
      ...(termsAccepted ? { terms_accepted_at: nowSec } : {}),
    })
    .eq("id", userId)
    .is("adult_confirmed_at", null)
    .select("*")
    .limit(1);

  if (error) throw error;
  if (data?.[0]) return mapUserRow(data[0]);

  // Ya estaba confirmado (o no existe): se conserva la fecha original.
  return getUserById(userId);
};

/** Cambia el nombre guardado de una plataforma (!rename: el chat trae el nombre actual). */
export const updatePlatformUsername = async (
  userId: number,
  platform: "kick" | "twitch",
  username: string
) => {
  const { error } = await getSupabaseAdmin()
    .from("users")
    .update(platform === "kick" ? { kick_username: username } : { twitch_username: username })
    .eq("id", userId);
  if (error) throw error;
};
