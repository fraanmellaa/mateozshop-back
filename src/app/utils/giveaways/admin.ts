import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export interface DecoratedGiveaway {
  id: number;
  title: string;
  image: string;
  cost: number;
  start_at: number;
  end_at: number;
  winner: number | null;
  winner_username?: string;
  winner_image?: string;
  status: "upcoming" | "active" | "finished";
  participants_count: number;
  created_at: string;
}

export async function getGiveaways(): Promise<DecoratedGiveaway[]> {
  const now = Math.floor(Date.now() / 1000);

  const { data: rows, error } = await supabase
    .from("giveaways")
    .select("id, title, image, cost, start_at, end_at, winner")
    .order("id", { ascending: false });

  if (error) throw error;

  const winnerIds = Array.from(
    new Set((rows || []).map((row) => row.winner).filter((id): id is number => Boolean(id)))
  );

  const winnersById = new Map<number, { username: string | null; image: string | null }>();

  if (winnerIds.length > 0) {
    const { data: winnerRows, error: winnersError } = await supabase
      .from("users")
      .select("id, username, image")
      .in("id", winnerIds);

    if (winnersError) throw winnersError;

    for (const winner of winnerRows || []) {
      winnersById.set(winner.id, {
        username: winner.username,
        image: winner.image,
      });
    }
  }

  const { data: entries, error: entriesError } = await supabase
    .from("giveaways_entries")
    .select("giveaway_id");

  if (entriesError) throw entriesError;

  const participantsCountByGiveaway = new Map<number, number>();
  for (const entry of entries || []) {
    participantsCountByGiveaway.set(
      entry.giveaway_id,
      (participantsCountByGiveaway.get(entry.giveaway_id) || 0) + 1
    );
  }

  return (rows || []).map((giveaway) => {
    let status: "upcoming" | "active" | "finished";

    if (now < giveaway.start_at) {
      status = "upcoming";
    } else if (now >= giveaway.start_at && now < giveaway.end_at) {
      status = "active";
    } else {
      status = "finished";
    }

    const winnerMeta = giveaway.winner ? winnersById.get(giveaway.winner) : undefined;

    return {
      id: giveaway.id,
      title: giveaway.title,
      image: giveaway.image,
      cost: giveaway.cost,
      start_at: giveaway.start_at,
      end_at: giveaway.end_at,
      winner: giveaway.winner,
      winner_username: winnerMeta?.username || undefined,
      winner_image: winnerMeta?.image || undefined,
      participants_count: participantsCountByGiveaway.get(giveaway.id) || 0,
      status,
      created_at: new Date(giveaway.start_at * 1000).toLocaleDateString("es-ES"),
    };
  });
}

export async function createGiveaway(data: {
  title: string;
  image: string;
  cost: number;
  start_at: number;
  end_at: number;
}) {
  const { data: result, error } = await supabase
    .from("giveaways")
    .insert({
      title: data.title,
      image: data.image,
      cost: data.cost,
      start_at: data.start_at,
      end_at: data.end_at,
    })
    .select("*");

  if (error) throw error;

  return result?.[0];
}

export async function updateGiveaway(
  id: number,
  data: {
    title?: string;
    image?: string;
    cost?: number;
    start_at?: number;
    end_at?: number;
    sendable?: boolean;
    codes?: string[];
    used_codes?: string[];
  }
) {
  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.image !== undefined) updateData.image = data.image;
  if (data.cost !== undefined) updateData.cost = data.cost;
  if (data.start_at !== undefined) updateData.start_at = data.start_at;
  if (data.end_at !== undefined) updateData.end_at = data.end_at;
  if (data.sendable !== undefined) {
    updateData.sendable = data.sendable;
    if (!data.sendable) {
      updateData.codes = [];
      updateData.used_codes = [];
    }
  }
  if (data.codes !== undefined) updateData.codes = data.codes;
  if (data.used_codes !== undefined) updateData.used_codes = data.used_codes;

  const { data: result, error } = await supabase
    .from("giveaways")
    .update(updateData)
    .eq("id", id)
    .select("*");

  if (error) throw error;

  return result?.[0];
}

export async function finishGiveaway(id: number) {
  const now = Math.floor(Date.now() / 1000);

  const { data: result, error } = await supabase
    .from("giveaways")
    .update({ end_at: now })
    .eq("id", id)
    .select("*");

  if (error) throw error;

  return result?.[0];
}

export async function deleteGiveaway(id: number) {
  const { error } = await supabase.from("giveaways").delete().eq("id", id);
  if (error) throw error;
}
