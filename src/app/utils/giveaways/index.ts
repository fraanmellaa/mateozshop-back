"use server";

import { db } from "@/db/drizzle";
import { giveaways, giveaways_entries, users } from "@/db/schema";
import { count, eq, inArray } from "drizzle-orm";
import { sendEmail } from "@/app/utils/email";

export const getGiveaways = async () => {
  const now = Math.floor(Date.now() / 1000);

  // Get all giveaways
  const giveawaysList = await db.select().from(giveaways).execute();
  const giveawaysData = await Promise.all(
    giveawaysList.map(async (giveaway) => {
      // Get all entries for this giveaway, join with users
      const entries = await db
        .select({
          userId: giveaways_entries.user_id,
          tickets: count(giveaways_entries.user_id),
          name: users.username,
          profileImage: users.image,
        })
        .from(giveaways_entries)
        .innerJoin(users, eq(giveaways_entries.user_id, users.id))
        .where(eq(giveaways_entries.giveaway_id, giveaway.id))
        .groupBy(giveaways_entries.user_id, users.username, users.image)
        .execute();

      let winners: {
        id: number;
        name: string;
        profileImage: string;
      }[] = [];

      // If giveaway is past and has winner(s)
      // To test
      // if ((giveaway.end_at < now && giveaway.winner) || giveaway.winner) {
      if (giveaway.end_at < now && giveaway.winner) {
        // winner can be a single id or array of ids
        const winnerIds = Array.isArray(giveaway.winner)
          ? giveaway.winner
          : [giveaway.winner];
        winners = await db
          .select({
            id: users.id,
            name: users.username,
            profileImage: users.image,
          })
          .from(users)
          .where(
            winnerIds.length === 1
              ? eq(users.id, winnerIds[0])
              : inArray(users.id, winnerIds)
          )
          .execute();
      }

      return {
        ...giveaway,
        entries,
        winners,
      };
    })
  );

  // separamos entre actuales y pasados por fecha
  const actualGiveaways = giveawaysData.filter(
    (giveaway) => giveaway.start_at < now && giveaway.end_at > now
  );
  const pastGiveaways = giveawaysData.filter(
    (giveaway) => giveaway.end_at < now
  );

  return {
    actual: actualGiveaways,
    past: pastGiveaways,
  };
};

export const getGiveawayById = async (id: number) => {
  const giveaway = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, id))
    .execute();
  if (!giveaway.length) return null;

  const now = Math.floor(Date.now() / 1000);

  const entries = await db
    .select({
      userId: giveaways_entries.user_id,
      tickets: count(giveaways_entries.user_id),
      name: users.username,
      profileImage: users.image,
      kickId: users.kick_id,
    })
    .from(giveaways_entries)
    .innerJoin(users, eq(giveaways_entries.user_id, users.id))
    .where(eq(giveaways_entries.giveaway_id, giveaway[0].id))
    .groupBy(
      giveaways_entries.user_id,
      users.username,
      users.image,
      users.kick_id
    )
    .execute();

  let winners: {
    id: number;
    name: string;
    profileImage: string;
  }[] = [];

  if (giveaway[0].end_at < now && giveaway[0].winner) {
    const winnerIds = Array.isArray(giveaway[0].winner)
      ? giveaway[0].winner
      : [giveaway[0].winner];
    winners = await db
      .select({
        id: users.id,
        name: users.username,
        profileImage: users.image,
        kickId: users.kick_id,
      })
      .from(users)
      .where(
        winnerIds.length === 1
          ? eq(users.id, winnerIds[0])
          : inArray(users.id, winnerIds)
      )
      .execute();
  }

  return {
    ...giveaway[0],
    entries,
    winners,
    comments: (giveaway[0].comments || []).sort(
      (a, b) => b.created_at - a.created_at
    ),
  };
};

export const getUserGiveaways = async (userId: number) => {
  const now = Math.floor(Date.now() / 1000);

  // Obtener todos los sorteos en los que el usuario tiene entradas
  const userGiveaways = await db
    .select({
      giveaway: {
        id: giveaways.id,
        title: giveaways.title,
        image: giveaways.image,
        start_at: giveaways.start_at,
        end_at: giveaways.end_at,
        winner: giveaways.winner,
        cost: giveaways.cost,
      },
      tickets: count(giveaways_entries.user_id),
    })
    .from(giveaways_entries)
    .innerJoin(giveaways, eq(giveaways_entries.giveaway_id, giveaways.id))
    .where(eq(giveaways_entries.user_id, userId))
    .groupBy(
      giveaways.id,
      giveaways.title,
      giveaways.image,
      giveaways.start_at,
      giveaways.end_at,
      giveaways.winner,
      giveaways.cost
    )
    .execute();

  // Para cada sorteo, obtener el total de tickets y calcular probabilidad
  const decoratedGiveaways = await Promise.all(
    userGiveaways.map(async (item) => {
      const giveaway = item.giveaway;
      let status: string;
      let isWinner = false;

      if (giveaway.start_at > now) {
        status = "upcoming"; // Próximo
      } else if (giveaway.end_at > now) {
        status = "active"; // Activo
      } else if (giveaway.winner) {
        status = "finished"; // Finalizado
        isWinner = giveaway.winner === userId;
      } else {
        status = "pending"; // Esperando sorteo
      }

      // Obtener el total de tickets para este sorteo
      const totalTicketsResult = await db
        .select({
          totalTickets: count(giveaways_entries.id),
        })
        .from(giveaways_entries)
        .where(eq(giveaways_entries.giveaway_id, giveaway.id))
        .execute();

      const totalTickets = totalTicketsResult[0]?.totalTickets || 0;
      const userTickets = item.tickets;

      // Calcular probabilidad de ganar (tickets del usuario / total de tickets)
      const winProbability =
        totalTickets > 0 ? (userTickets / totalTickets) * 100 : 0;

      return {
        id: giveaway.id,
        title: giveaway.title,
        image: giveaway.image,
        cost: giveaway.cost,
        status,
        tickets: userTickets,
        totalTickets,
        winProbability: Math.round(winProbability * 100) / 100, // Redondear a 2 decimales
        isWinner,
        start_at: giveaway.start_at,
        end_at: giveaway.end_at,
        created_at: new Date(giveaway.start_at * 1000).toISOString(),
      };
    })
  );

  return decoratedGiveaways;
};

// Función para agregar comentario a un sorteo
export const addGiveawayComment = async (id: number, message: string) => {
  try {
    const giveaway = await db
      .select()
      .from(giveaways)
      .where(eq(giveaways.id, id))
      .execute();

    if (!giveaway.length) {
      throw new Error("Sorteo no encontrado");
    }

    const currentComments = giveaway[0].comments || [];
    const newComment = {
      created_at: Math.floor(Date.now() / 1000),
      message,
    };

    const updatedComments = [...currentComments, newComment];

    await db
      .update(giveaways)
      .set({ comments: updatedComments })
      .where(eq(giveaways.id, id))
      .execute();

    return { success: true, comment: newComment };
  } catch (error) {
    console.error("Error adding comment:", error);
    throw error;
  }
};

// Función para enviar email al ganador
export const sendWinnerEmail = async (
  giveawayId: number,
  winnerId: number,
  customSubject?: string,
  customMessage?: string
) => {
  try {
    // Obtener detalles del sorteo
    const giveaway = await db
      .select()
      .from(giveaways)
      .where(eq(giveaways.id, giveawayId))
      .execute();

    if (!giveaway.length) {
      throw new Error("Sorteo no encontrado");
    }

    // Obtener información del ganador
    const winnerUser = await db
      .select({
        email: users.email,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, winnerId))
      .execute();

    if (!winnerUser.length) {
      throw new Error("Ganador no encontrado");
    }

    const winner = winnerUser[0];

    // Usar el mensaje personalizado o el por defecto
    const defaultMessage = `¡Enhorabuena! Has sido seleccionado como ganador de nuestro sorteo.
            Nuestro equipo se pondrá en contacto contigo pronto para coordinar la entrega del premio.`;

    const message = customMessage || defaultMessage;

    // Crear el contenido del email
    const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>¡Has ganado el sorteo!</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb;">🎉 ¡Felicidades ${winner.username}!</h1>
          <h2>Has ganado el sorteo: ${giveaway[0].title}</h2>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <img src="${giveaway[0].image}" alt="${giveaway[0].title}" style="max-width: 400px; border-radius: 8px;">
        </div>
        
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 16px; white-space: pre-line;">
            ${message}
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #64748b;">
          <p>Gracias por participar en nuestros sorteos</p>
          <p>— El equipo de MateozShop</p>
        </div>
      </body>
      </html>
    `;

    // Usar el asunto personalizado o el por defecto
    const subject =
      customSubject || `¡Felicidades! Has ganado: ${giveaway[0].title}`;

    await sendEmail(winner.email, subject, emailContent);

    return { success: true };
  } catch (error) {
    console.error("Error sending winner email:", error);
    throw error;
  }
};
