import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "./fetchAll";

// Columnas de las rutas públicas: nunca `codes`, `used_codes` ni `comments`.
// `draw_seed` y `draw_log` se leen para revelarlos SOLO tras el sorteo.
const PUBLIC_GIVEAWAY_COLUMNS =
  "id, cost, title, image, start_at, end_at, winner, is_closed, rules, draw_seed_hash, draw_seed, drawn_at, draw_log";

type DrawLog = {
  n: number;
  index: number;
  winner_entry_id: number;
  entry_ids: number[];
  excluded_entry_ids: number[];
};

type PublicRow = {
  draw_seed: string | null;
  draw_log: DrawLog | null;
  drawn_at: number | null;
  rules: string | null;
  draw_seed_hash: string | null;
};

/**
 * Datos de verificación del sorteo. Antes del sorteo solo se publica el hash
 * (`draw_seed` es null). Tras el sorteo se revela la semilla y la lista
 * ORDENADA de ids de entrada usada (solo ids de entrada, sin usuarios: quién
 * ganó ya sale en `winners`), el índice y las entradas excluidas por baneo.
 * Verificación: sha256(draw_seed) == draw_seed_hash e
 * índice = floor(uniformAt(draw_seed, String(id), 0, 0) * n).
 */
function publicDrawFields(row: PublicRow) {
  const drawn = row.drawn_at !== null && row.draw_seed !== null;
  return {
    rules: row.rules ?? null,
    draw_seed_hash: row.draw_seed_hash ?? null,
    draw_seed: drawn ? row.draw_seed : null,
    drawn_at: row.drawn_at ?? null,
    draw: drawn && row.draw_log ? row.draw_log : null,
  };
}

function stripSecrets<T extends PublicRow>(row: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { draw_seed, draw_log, drawn_at, rules, draw_seed_hash, ...rest } = row;
  return rest;
}

async function countEntries(giveawayId: number) {
  const { count, error } = await getSupabaseAdmin()
    .from("giveaways_entries")
    .select("id", { count: "exact", head: true })
    .eq("giveaway_id", giveawayId);
  if (error) throw error;
  return count ?? 0;
}

type EntryRow = {
  user_id: number;
  user: { username: string | null; image: string | null; kick_id: string | null } | null;
};

/** Participantes de un sorteo agrupados por usuario, con su número de tickets. */
export async function getGiveawayEntries(giveawayId: number) {
  const supabase = getSupabaseAdmin();

  const entries = await fetchAllRows<EntryRow>((from, to) =>
    supabase
      .from("giveaways_entries")
      .select("user_id, user:users!giveaways_entries_user_id_users_id_fk(username, image, kick_id)")
      .eq("giveaway_id", giveawayId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: unknown }>
  );

  const grouped = new Map<
    number,
    { userId: number; tickets: number; name: string; profileImage: string; kickId: string | null }
  >();

  for (const entry of entries) {
    const user = Array.isArray(entry.user) ? entry.user[0] : entry.user;
    const current = grouped.get(entry.user_id);
    if (current) {
      current.tickets += 1;
    } else {
      grouped.set(entry.user_id, {
        userId: entry.user_id,
        tickets: 1,
        name: user?.username || "",
        profileImage: user?.image || "",
        kickId: user?.kick_id || null,
      });
    }
  }

  return Array.from(grouped.values());
}

export async function getGiveawayWinners(giveaway: { end_at: number; winner: number | null }) {
  const now = Math.floor(Date.now() / 1000);
  if (giveaway.end_at >= now || !giveaway.winner) return [];

  const { data: winnerRows, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, username, image, kick_id")
    .eq("id", giveaway.winner);
  if (error) throw error;

  return (winnerRows || []).map((w) => ({
    id: w.id as number,
    name: w.username as string,
    profileImage: w.image as string,
    kickId: (w.kick_id ?? null) as string | null,
  }));
}

/** Listado para la web pública. */
export const getGiveaways = async () => {
  const now = Math.floor(Date.now() / 1000);

  const { data: giveawaysList, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select(PUBLIC_GIVEAWAY_COLUMNS)
    .order("id", { ascending: true });
  if (error) throw error;

  const giveawaysData = await Promise.all(
    ((giveawaysList || []) as unknown as (PublicRow & { id: number; start_at: number; end_at: number; winner: number | null })[]).map(
      async (giveaway) => {
        // Entradas y ganador a la vez (antes, una consulta detrás de otra).
        const [entries, winners] = await Promise.all([
          getGiveawayEntries(giveaway.id),
          getGiveawayWinners(giveaway),
        ]);
        return {
          ...stripSecrets(giveaway),
          ...publicDrawFields(giveaway),
          // La lista no lleva las bases (texto largo): están en el detalle.
          rules: undefined,
          entries,
          entries_count: entries.reduce((sum, e) => sum + e.tickets, 0),
          winners,
        };
      }
    )
  );

  return {
    actual: giveawaysData.filter((g) => g.start_at < now && g.end_at > now),
    past: giveawaysData.filter((g) => g.end_at < now),
  };
};

/** Detalle para la web pública. */
export const getGiveawayById = async (id: number) => {
  const { data: giveawayRows, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select(PUBLIC_GIVEAWAY_COLUMNS)
    .eq("id", id)
    .limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0] as unknown as
    | (PublicRow & { id: number; end_at: number; winner: number | null })
    | undefined;
  if (!giveaway) return null;

  // Las tres lecturas no dependen entre sí: van a la vez.
  const [entriesCount, entries, winners] = await Promise.all([
    countEntries(giveaway.id),
    getGiveawayEntries(giveaway.id),
    getGiveawayWinners(giveaway),
  ]);
  return {
    ...stripSecrets(giveaway),
    ...publicDrawFields(giveaway),
    entries_count: entriesCount,
    entries,
    winners,
  };
};

export const getUserGiveaways = async (userId: number) => {
  const now = Math.floor(Date.now() / 1000);
  const supabase = getSupabaseAdmin();

  const entries = await fetchAllRows<{ giveaway_id: number }>((from, to) =>
    supabase
      .from("giveaways_entries")
      .select("giveaway_id")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const userTicketsByGiveaway = new Map<number, number>();
  for (const entry of entries) {
    userTicketsByGiveaway.set(
      entry.giveaway_id,
      (userTicketsByGiveaway.get(entry.giveaway_id) || 0) + 1
    );
  }

  const ids = Array.from(userTicketsByGiveaway.keys());
  if (ids.length === 0) return [];

  const { data: giveaways, error: giveawaysError } = await supabase
    .from("giveaways")
    .select("id, title, image, start_at, end_at, winner, cost")
    .in("id", ids);

  if (giveawaysError) throw giveawaysError;

  // Total de tickets de cada sorteo, contando los de todos los usuarios.
  const totalTicketsByGiveaway = new Map<number, number>();
  await Promise.all(
    ids.map(async (giveawayId) => {
      const { count, error } = await supabase
        .from("giveaways_entries")
        .select("id", { count: "exact", head: true })
        .eq("giveaway_id", giveawayId);
      if (error) throw error;
      totalTicketsByGiveaway.set(giveawayId, count ?? 0);
    })
  );

  return (giveaways || []).map((giveaway) => {
    const userTickets = userTicketsByGiveaway.get(giveaway.id) || 0;
    const totalTickets = totalTicketsByGiveaway.get(giveaway.id) || 0;

    let status: string;
    let isWinner = false;

    if (giveaway.start_at > now) status = "upcoming";
    else if (giveaway.end_at > now) status = "active";
    else if (giveaway.winner) {
      status = "finished";
      isWinner = giveaway.winner === userId;
    } else status = "pending";

    const winProbability = totalTickets > 0 ? (userTickets / totalTickets) * 100 : 0;

    return {
      id: giveaway.id,
      title: giveaway.title,
      image: giveaway.image,
      cost: giveaway.cost,
      status,
      tickets: userTickets,
      totalTickets,
      winProbability: Math.round(winProbability * 100) / 100,
      isWinner,
      start_at: giveaway.start_at,
      end_at: giveaway.end_at,
      created_at: new Date(giveaway.start_at * 1000).toISOString(),
    };
  });
};
