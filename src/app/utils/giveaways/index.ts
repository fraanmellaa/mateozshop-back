"use server";

import { createClient } from "@supabase/supabase-js";
import { sendCustomEmail } from "@/app/utils/email";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export const getGiveaways = async () => {
  const now = Math.floor(Date.now() / 1000);

  const { data: giveawaysList, error } = await supabase.from("giveaways").select("*");
  if (error) throw error;

  const giveawaysData = await Promise.all(
    (giveawaysList || []).map(async (giveaway) => {
      const { data: entriesRows } = await supabase
        .from("giveaways_entries")
        .select("user_id, user:users!giveaways_entries_user_id_fkey(username, image)")
        .eq("giveaway_id", giveaway.id);

      const grouped = new Map<number, { userId: number; tickets: number; name: string; profileImage: string }>();
      for (const entry of entriesRows || []) {
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
          });
        }
      }

      let winners: { id: number; name: string; profileImage: string }[] = [];
      if (giveaway.end_at < now && giveaway.winner) {
        const winnerIds = Array.isArray(giveaway.winner) ? giveaway.winner : [giveaway.winner];
        const { data: winnerRows } = await supabase
          .from("users")
          .select("id, username, image")
          .in("id", winnerIds);

        winners = (winnerRows || []).map((w) => ({
          id: w.id,
          name: w.username,
          profileImage: w.image,
        }));
      }

      return {
        ...giveaway,
        entries: Array.from(grouped.values()),
        winners,
      };
    })
  );

  return {
    actual: giveawaysData.filter((g) => g.start_at < now && g.end_at > now),
    past: giveawaysData.filter((g) => g.end_at < now),
  };
};

export const getGiveawayById = async (id: number) => {
  const { data: giveawayRows, error } = await supabase.from("giveaways").select("*").eq("id", id).limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) return null;

  const now = Math.floor(Date.now() / 1000);

  const { data: entriesRows } = await supabase
    .from("giveaways_entries")
    .select("user_id, user:users!giveaways_entries_user_id_fkey(username, image, kick_id)")
    .eq("giveaway_id", giveaway.id);

  const grouped = new Map<number, { userId: number; tickets: number; name: string; profileImage: string; kickId: string | null }>();
  for (const entry of entriesRows || []) {
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

  let winners: { id: number; name: string; profileImage: string; kickId: string | null }[] = [];
  if (giveaway.end_at < now && giveaway.winner) {
    const winnerIds = Array.isArray(giveaway.winner) ? giveaway.winner : [giveaway.winner];
    const { data: winnerRows } = await supabase
      .from("users")
      .select("id, username, image, kick_id")
      .in("id", winnerIds);

    winners = (winnerRows || []).map((w) => ({
      id: w.id,
      name: w.username,
      profileImage: w.image,
      kickId: w.kick_id,
    }));
  }

  return {
    ...giveaway,
    entries: Array.from(grouped.values()),
    winners,
    comments: (giveaway.comments || []).sort(
      (a: { created_at: number }, b: { created_at: number }) => b.created_at - a.created_at
    ),
  };
};

export const getUserGiveaways = async (userId: number) => {
  const now = Math.floor(Date.now() / 1000);

  const { data: entries, error } = await supabase
    .from("giveaways_entries")
    .select("giveaway_id")
    .eq("user_id", userId);

  if (error) throw error;

  const ids = Array.from(new Set((entries || []).map((e) => e.giveaway_id)));
  if (ids.length === 0) return [];

  const { data: giveaways, error: giveawaysError } = await supabase
    .from("giveaways")
    .select("id, title, image, start_at, end_at, winner, cost")
    .in("id", ids);

  if (giveawaysError) throw giveawaysError;

  const ticketCountByGiveaway = new Map<number, number>();
  for (const entry of entries || []) {
    ticketCountByGiveaway.set(
      entry.giveaway_id,
      (ticketCountByGiveaway.get(entry.giveaway_id) || 0) + 1
    );
  }

  return (giveaways || []).map((giveaway) => {
    const userTickets = ticketCountByGiveaway.get(giveaway.id) || 0;
    const totalTickets = (entries || []).filter((e) => e.giveaway_id === giveaway.id).length;

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

export const addGiveawayComment = async (id: number, message: string) => {
  const { data: giveawayRows, error } = await supabase.from("giveaways").select("comments").eq("id", id).limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) throw new Error("Sorteo no encontrado");

  const currentComments = giveaway.comments || [];
  const newComment = {
    created_at: Math.floor(Date.now() / 1000),
    message,
  };

  const { error: updateError } = await supabase
    .from("giveaways")
    .update({ comments: [...currentComments, newComment] })
    .eq("id", id);

  if (updateError) throw updateError;

  return { success: true, comment: newComment };
};

export const sendWinnerEmail = async (
  giveawayId: number,
  winnerId: number,
  customSubject?: string,
  customMessage?: string
) => {
  const { data: giveawayRows, error } = await supabase
    .from("giveaways")
    .select("title, image")
    .eq("id", giveawayId)
    .limit(1);

  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) throw new Error("Sorteo no encontrado");

  const { data: winnerRows, error: winnerError } = await supabase
    .from("users")
    .select("email, username")
    .eq("id", winnerId)
    .limit(1);

  if (winnerError) throw winnerError;

  const winner = winnerRows?.[0];
  if (!winner) throw new Error("Ganador no encontrado");

  const defaultMessage = `¡Enhorabuena! Has sido seleccionado como ganador de nuestro sorteo.
Nuestro equipo se pondrá en contacto contigo pronto para coordinar la entrega del premio.`;

  const message = customMessage || defaultMessage;
  const subject = customSubject || `¡Felicidades! Has ganado: ${giveaway.title}`;

  await sendCustomEmail(winner.email, subject, message);

  return { success: true };
};
