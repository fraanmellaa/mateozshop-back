import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountErrorResponse } from "@/app/utils/accounts";
import { requireExtensionUser } from "@/app/utils/extensionAuth";
import { RATE_RULES, memoryRateLimit } from "@/app/utils/rateLimit";
import { getUserByDiscordId } from "@/app/utils/users";

import { GameError } from "./errors";

/** Capa fina compartida por las rutas web (`/api/games`) y de extensión (`/api/extension/games`). */
export type Channel = "web" | "extension";

export function extensionOk(data: unknown) {
  return NextResponse.json({ success: true, data });
}

/** Traduce un error a la respuesta del contrato, sin filtrar mensajes internos. */
export function gameErrorResponse(error: unknown, channel: Channel) {
  const account = accountErrorResponse(error);
  if (account) return account;

  if (error instanceof GameError) {
    // La web siempre llamó NOT_ENOUGH_POINTS a este error.
    const code =
      channel === "web" && error.code === "INSUFFICIENT_POINTS" ? "NOT_ENOUGH_POINTS" : error.code;
    return NextResponse.json(
      { success: false, error: code, ...error.extra },
      { status: error.status }
    );
  }

  console.error("Games API error:", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ success: false, error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}

type Context<B> = { userId: number; body: B };

/**
 * Autentica según el canal, valida el cuerpo (si hay `schema`) y ejecuta el
 * handler. Web: el servidor del front pone `discord_id` (query o cuerpo).
 * Extensión: JWT de extensión.
 */
export async function gameRoute<B = undefined>(
  request: NextRequest,
  channel: Channel,
  options: { schema?: z.ZodType<B> },
  handler: (ctx: Context<B>) => Promise<unknown>
) {
  try {
    const raw: unknown = options.schema ? await request.json().catch(() => null) : null;

    let userId: number;
    if (channel === "extension") {
      const auth = await requireExtensionUser(request);
      if (!auth.ok) return auth.response;
      userId = auth.user.id;
    } else {
      const fromBody =
        typeof raw === "object" && raw !== null ? (raw as { discord_id?: unknown }).discord_id : undefined;
      const discordId = request.nextUrl.searchParams.get("discord_id") ?? fromBody;
      if (typeof discordId !== "string" || discordId.length === 0 || discordId.length > 64) {
        throw new GameError("INVALID_REQUEST_BODY", 400);
      }
      const user = await getUserByDiscordId(discordId);
      if (!user) throw new GameError("USER_NOT_FOUND", 404);
      userId = user.id;
    }

    // Tope por usuario para las jugadas (no para los sondeos de estado): solo
    // frena a un script; una persona no llega ni de lejos.
    if (options.schema && !memoryRateLimit(`game:${userId}`, RATE_RULES.game)) {
      throw new GameError("RATE_LIMITED", 429);
    }

    let body = undefined as B;
    if (options.schema) {
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) throw new GameError("INVALID_REQUEST_BODY", 400);
      body = parsed.data;
    }

    return extensionOk(await handler({ userId, body }));
  } catch (error) {
    return gameErrorResponse(error, channel);
  }
}

// Esquemas de cuerpo. La validación fina (rangos, riesgo, número de bolas) la
// hace el motor, con su código de error propio.
export const crashBetBody = z.object({
  roundId: z.unknown(),
  bet: z.unknown(),
  autoCashout: z.unknown().optional(),
  requestId: z.unknown(),
});
export const crashRoundBody = z.object({ roundId: z.unknown() });
export const plinkoBody = z.object({ bet: z.unknown(), risk: z.unknown(), count: z.unknown().optional() });
export const clientSeedBody = z.object({ client_seed: z.unknown() });
export const rotateBody = z.object({ client_seed: z.unknown().optional() });

export const emptyBody = z.object({});
export const spinBody = z.object({ count: z.unknown() });

/** Id numérico de una ruta `[id]`. */
export function parseId(value: string): number {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) {
    throw new GameError("INVALID_ID", 400);
  }
  return id;
}
