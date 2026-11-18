import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fairReserve, type FairState } from "@/app/utils/fair";
import { PointsError, isPointsError, type PointsErrorCode } from "@/app/utils/points";

import { drawPrize, fairUniform } from "./draw";
import { GateError, assertCanSpend, isGateCode } from "./gates";
import {
  LootBoxError,
  assertBoxRules,
  assertPrizeShape,
  createBoxSchema,
  createPrizeSchema,
  isBoxSoldOut,
  isDrawable,
  updateBoxSchema,
  updatePrizeSchema,
  zodMessage,
} from "./rules";
import {
  RARITIES,
  type AdminBox,
  type AdminOpening,
  type BoxOdds,
  type BoxRow,
  type OpenedPrize,
  type OpeningStatus,
  type PrizeKind,
  type PrizeRow,
  type PublicBox,
  type PublicPrize,
  type Rarity,
  type UserOpening,
} from "./types";

export * from "./types";
export { LootBoxError } from "./rules";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const rarityOrder = (r: Rarity) => RARITIES.indexOf(r);

const BOX_COLUMNS =
  "id, name, description, image, price, weight_common, weight_rare, weight_epic, weight_legendary, position, is_active, created_at, updated_at";
const PRIZE_COLUMNS =
  "id, box_id, rarity, kind, name, description, image, points, weight, stock, fallback_points, is_active, position, created_at, updated_at";

// ───────────────────────── lectura pública ─────────────────────────

/**
 * Cajas activas con sus premios activos. Un premio agotado sigue en la lista
 * (puede salir y dar sus puntos de respaldo). Nunca pesos, unidades ni
 * respaldo: del stock solo sale si un premio o la caja entera están agotados.
 */
export async function getPublicLootBoxes(): Promise<PublicBox[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .select(`id, name, description, image, price, prizes:loot_box_prizes(${PRIZE_COLUMNS})`)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  return ((data || []) as unknown as (BoxRow & { prizes: PrizeRow[] })[]).map((box) => ({
    id: box.id,
    name: box.name,
    description: box.description,
    image: box.image,
    price: box.price,
    sold_out: isBoxSoldOut(box.prizes || []),
    prizes: (box.prizes || [])
      .filter(isDrawable)
      .sort(
        (a, b) =>
          rarityOrder(a.rarity) - rarityOrder(b.rarity) || a.position - b.position || a.id - b.id
      )
      .map(
        (p): PublicPrize => ({
          id: p.id,
          name: p.name,
          description: p.description,
          image: p.image,
          rarity: p.rarity,
          kind: p.kind,
          points: p.points,
          sold_out: p.kind === "item" && p.stock !== null && p.stock <= 0,
        })
      ),
  }));
}

/**
 * Probabilidades publicadas: por categoría (puntos básicos, 7000 = 70 %) y por
 * premio. Reproduce exactamente el sorteo de `drawPrize`: la categoría sale por
 * peso y, dentro de ella, el premio por su peso relativo; una categoría sin
 * premios activos cede su probabilidad a la inferior.
 */
export async function getLootBoxOdds(): Promise<BoxOdds[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .select(
      "id, name, weight_common, weight_rare, weight_epic, weight_legendary, prizes:loot_box_prizes(name, rarity, weight, is_active, position, id)"
    )
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  type OddsPrize = { name: string; rarity: Rarity; weight: number; is_active: boolean; position: number; id: number };

  return ((data || []) as unknown as (BoxRow & { prizes: OddsPrize[] })[]).map((b) => {
    const odds = {
      common: b.weight_common,
      rare: b.weight_rare,
      epic: b.weight_epic,
      legendary: b.weight_legendary,
    };
    const active = (b.prizes || []).filter((p) => p.is_active && p.weight > 0);

    // Masa efectiva por categoría: de la más alta a la más baja, una categoría
    // sin premios cede lo suyo a la siguiente inferior.
    const effective: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = RARITIES.length - 1; i >= 0; i--) {
      const rarity = RARITIES[i];
      let mass = odds[rarity];
      for (let j = i; j >= 0 && mass > 0; j--) {
        if (active.some((p) => p.rarity === RARITIES[j])) {
          effective[RARITIES[j]] += mass;
          mass = 0;
        }
      }
    }

    const prizes = [...active]
      .sort(
        (a, c) => rarityOrder(a.rarity) - rarityOrder(c.rarity) || a.position - c.position || a.id - c.id
      )
      .map((p) => {
        const categoryWeight = active
          .filter((q) => q.rarity === p.rarity)
          .reduce((sum, q) => sum + q.weight, 0);
        const probability = categoryWeight > 0 ? (effective[p.rarity] * p.weight) / categoryWeight : 0;
        return { name: p.name, rarity: p.rarity, probability: Math.round(probability * 100) / 100 };
      });

    return { id: b.id, name: b.name, odds, prizes };
  });
}

export async function getUserLootBoxOpenings(userId: number): Promise<UserOpening[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_box_openings")
    .select("id, box_name, prize_name, rarity, kind, points_awarded, status, delivery_note, fallback, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data || []) as UserOpening[];
}

// ───────────────────────── lectura admin ─────────────────────────

const sortPrizes = (prizes: PrizeRow[]) =>
  [...prizes].sort(
    (a, b) => rarityOrder(a.rarity) - rarityOrder(b.rarity) || a.position - b.position || a.id - b.id
  );

export async function getAdminLootBoxes(): Promise<AdminBox[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .select(`${BOX_COLUMNS}, prizes:loot_box_prizes(${PRIZE_COLUMNS})`)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  return ((data || []) as unknown as AdminBox[]).map((box) => ({
    ...box,
    prizes: sortPrizes(box.prizes || []),
  }));
}

async function getBoxOrThrow(boxId: number): Promise<BoxRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .select(BOX_COLUMNS)
    .eq("id", boxId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LootBoxError("BOX_NOT_FOUND", "La caja no existe.", 404);
  return data as BoxRow;
}

async function getBoxPrizes(boxId: number): Promise<PrizeRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_box_prizes")
    .select(PRIZE_COLUMNS)
    .eq("box_id", boxId);
  if (error) throw error;
  return (data || []) as PrizeRow[];
}

async function getPrizeOrThrow(prizeId: number): Promise<PrizeRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("loot_box_prizes")
    .select(PRIZE_COLUMNS)
    .eq("id", prizeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LootBoxError("PRIZE_NOT_FOUND", "El premio no existe.", 404);
  return data as PrizeRow;
}

// ───────────────────────── escritura admin ─────────────────────────
// Las validaciones viven en el servidor (rules.ts); el panel solo las repite
// en vivo como ayuda.

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: import("zod").ZodError }): T {
  if (!result.success) throw new LootBoxError("VALIDATION_ERROR", zodMessage(result.error));
  return result.data;
}

export async function createLootBox(input: unknown): Promise<AdminBox> {
  const data = parseOrThrow(createBoxSchema.safeParse(input));
  // Una caja nueva no tiene premios: solo puede nacer activa si las reglas lo permiten (no puede).
  assertBoxRules(data, []);

  const now = nowSeconds();
  const { data: created, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .insert({
      ...data,
      description: data.description ?? null,
      image: data.image ?? null,
      created_at: now,
      updated_at: now,
    })
    .select(BOX_COLUMNS)
    .single();
  if (error) throw error;
  return { ...(created as BoxRow), prizes: [] };
}

export async function updateLootBox(boxId: number, input: unknown): Promise<BoxRow> {
  const patch = parseOrThrow(updateBoxSchema.safeParse(input));
  const current = await getBoxOrThrow(boxId);
  const merged = { ...current, ...patch };

  assertBoxRules(merged, await getBoxPrizes(boxId));

  const { data, error } = await getSupabaseAdmin()
    .from("loot_boxes")
    .update({ ...patch, updated_at: nowSeconds() })
    .eq("id", boxId)
    .select(BOX_COLUMNS)
    .single();
  if (error) throw error;
  return data as BoxRow;
}

/** Borra la caja y sus premios; el histórico de aperturas se conserva (SET NULL). */
export async function deleteLootBox(boxId: number): Promise<void> {
  await getBoxOrThrow(boxId);
  const { error } = await getSupabaseAdmin().from("loot_boxes").delete().eq("id", boxId);
  if (error) throw error;
}

export async function createLootBoxPrize(boxId: number, input: unknown): Promise<PrizeRow> {
  const data = parseOrThrow(createPrizeSchema.safeParse(input));
  const box = await getBoxOrThrow(boxId);

  const prize = {
    ...data,
    description: data.description ?? null,
    image: data.image ?? null,
    points: data.points ?? null,
    stock: data.stock ?? null,
    fallback_points: data.fallback_points ?? null,
  };
  assertPrizeShape(prize);
  // Añadir un premio no puede romper una caja activa, pero se comprueba el estado final.
  assertBoxRules(box, [...(await getBoxPrizes(boxId)), prize]);

  const now = nowSeconds();
  const { data: created, error } = await getSupabaseAdmin()
    .from("loot_box_prizes")
    .insert({ ...prize, box_id: boxId, created_at: now, updated_at: now })
    .select(PRIZE_COLUMNS)
    .single();
  if (error) throw error;
  return created as PrizeRow;
}

export async function updateLootBoxPrize(prizeId: number, input: unknown): Promise<PrizeRow> {
  const patch = parseOrThrow(updatePrizeSchema.safeParse(input));
  const current = await getPrizeOrThrow(prizeId);
  const merged: PrizeRow = { ...current, ...patch };
  // Al pasar a objeto sin indicar puntos, los puntos se quitan.
  if (merged.kind === "item" && patch.points === undefined) merged.points = null;
  const dbPatch = { ...patch, ...(merged.kind === "item" && patch.points === undefined ? { points: null } : {}) };

  assertPrizeShape(merged);
  const box = await getBoxOrThrow(current.box_id);
  const others = (await getBoxPrizes(current.box_id)).filter((p) => p.id !== prizeId);
  assertBoxRules(box, [...others, merged]);

  const { data, error } = await getSupabaseAdmin()
    .from("loot_box_prizes")
    .update({ ...dbPatch, updated_at: nowSeconds() })
    .eq("id", prizeId)
    .select(PRIZE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PrizeRow;
}

export async function deleteLootBoxPrize(prizeId: number): Promise<void> {
  const current = await getPrizeOrThrow(prizeId);
  const box = await getBoxOrThrow(current.box_id);
  const others = (await getBoxPrizes(current.box_id)).filter((p) => p.id !== prizeId);
  assertBoxRules(box, others);

  const { error } = await getSupabaseAdmin().from("loot_box_prizes").delete().eq("id", prizeId);
  if (error) throw error;
}

// ───────────────────────── aperturas (admin) ─────────────────────────

export const OPENINGS_PAGE_SIZE = 100;

const OPENING_COLUMNS =
  "id, user_id, box_id, prize_id, box_name, prize_name, rarity, kind, points_awarded, price_paid, status, delivery_note, delivered_at, created_at, fallback, server_seed_hash, client_seed, fair_nonce";

type OpeningDbRow = Omit<AdminOpening, "user"> & { user: AdminOpening["user"] | AdminOpening["user"][] };

const normalizeOpening = (row: OpeningDbRow): AdminOpening => ({
  ...row,
  user: Array.isArray(row.user) ? (row.user[0] ?? null) : (row.user ?? null),
});

export async function getAdminOpenings(
  status: OpeningStatus | null,
  page: number,
  kind: PrizeKind | null = null
): Promise<{ result: AdminOpening[]; page: number; has_more: boolean }> {
  const from = (page - 1) * OPENINGS_PAGE_SIZE;
  let query = getSupabaseAdmin()
    .from("loot_box_openings")
    .select(`${OPENING_COLUMNS}, user:users(username, email, kick_username, discord_id)`);
  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("kind", kind);

  // Las pendientes se entregan por orden de llegada; el resto, lo más nuevo primero.
  // Se pide una fila de más para saber si hay otra página.
  const { data, error } = await query
    .order("created_at", { ascending: status === "pending" })
    .order("id", { ascending: status === "pending" })
    .range(from, from + OPENINGS_PAGE_SIZE);
  if (error) throw error;

  const rows = ((data || []) as unknown as OpeningDbRow[]).map(normalizeOpening);
  return { result: rows.slice(0, OPENINGS_PAGE_SIZE), page, has_more: rows.length > OPENINGS_PAGE_SIZE };
}

/**
 * Marca como entregado un premio `pending`. Idempotente: si ya estaba
 * entregado devuelve `changed: false` sin tocar nada. Solo la transición real
 * pending -> delivered devuelve `changed: true` (y es la única que avisa).
 */
export async function markOpeningDelivered(
  openingId: number,
  note: string | null
): Promise<{ opening: AdminOpening; changed: boolean }> {
  const db = getSupabaseAdmin();
  const select = `${OPENING_COLUMNS}, user:users(username, email, kick_username, discord_id)`;

  // El filtro status = 'pending' hace la transición atómica: dos clics a la vez solo cambian una vez.
  const { data: updated, error } = await db
    .from("loot_box_openings")
    .update({ status: "delivered", delivery_note: note, delivered_at: nowSeconds() })
    .eq("id", openingId)
    .eq("status", "pending")
    .select(select);
  if (error) throw error;
  if (updated && updated.length > 0) {
    return { opening: normalizeOpening(updated[0] as unknown as OpeningDbRow), changed: true };
  }

  const { data: existing, error: readError } = await db
    .from("loot_box_openings")
    .select(select)
    .eq("id", openingId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw new LootBoxError("OPENING_NOT_FOUND", "La apertura no existe.", 404);

  const opening = normalizeOpening(existing as unknown as OpeningDbRow);
  if (opening.status === "delivered") return { opening, changed: false };
  throw new LootBoxError(
    "OPENING_NOT_PENDING",
    "Solo se pueden marcar como entregados los premios pendientes.",
    409
  );
}

// ───────────────────────── abrir una caja ─────────────────────────

export type OpenedLootBox = {
  opening_id: number;
  prize: OpenedPrize;
  status: "completed" | "pending";
  balance: number;
  fair: FairState;
};

type OpenRpcResult = {
  opening_id: number;
  prize_id: number;
  kind: "points" | "item";
  points_awarded: number;
  fallback: boolean;
  status: "completed" | "pending";
  balance: number;
};

const SQL_PASSTHROUGH = new Set<string>([
  "BOX_NOT_FOUND",
  "BOX_NOT_ACTIVE",
  "PRIZE_UNAVAILABLE",
  "PRIZE_OUT_OF_STOCK",
  "USER_NOT_FOUND",
  "USER_BANNED",
  "INSUFFICIENT_POINTS",
]);

/** open_loot_box (versión verificable, 0024). Traduce los errores de negocio. */
async function openLootBoxFairAtomic(userId: number, boxId: number, prizeId: number, fair: FairState) {
  const { data, error } = await getSupabaseAdmin().rpc("open_loot_box", {
    p_user_id: userId,
    p_box_id: boxId,
    p_prize_id: prizeId,
    p_fair: fair,
  });
  if (error) {
    const code = String(error.message || "").trim();
    if (isGateCode(code)) {
      throw new GateError(code, code === "ACCOUNT_TOO_NEW" && error.details ? { minDays: Number(error.details) } : {});
    }
    if (SQL_PASSTHROUGH.has(code)) throw new PointsError(code as PointsErrorCode, error.details ?? null);
    throw new Error(`open_loot_box failed: ${code || "unknown error"}`);
  }
  return data as OpenRpcResult;
}

const MAX_ATTEMPTS = 3;

/**
 * Abre una caja. El resultado se decide en el servidor con aleatoriedad
 * verificable (utils/fair): se reserva un nonce, la categoría sale del cursor 0
 * y el premio del cursor 1. open_loot_box (atómica) cobra, descuenta stock,
 * registra y abona. Si el premio sorteado se desactivó entre el sorteo y la
 * apertura se vuelve a sortear con datos frescos y otro nonce (máx. 3
 * intentos); después NO_PRIZES_AVAILABLE. Un premio con stock agotado NO
 * falla: entrega sus puntos de respaldo (`prize.fallback = true`).
 * Los requisitos de cuenta se validan ANTES de reservar nonce.
 * Lanza PointsError / GateError / AccountError con los códigos de negocio.
 */
export async function openLootBox(userId: number, boxId: number): Promise<OpenedLootBox> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await getSupabaseAdmin()
      .from("loot_boxes")
      .select(`${BOX_COLUMNS}, prizes:loot_box_prizes(${PRIZE_COLUMNS})`)
      .eq("id", boxId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new PointsError("BOX_NOT_FOUND");

    const box = data as unknown as BoxRow & { prizes: PrizeRow[] };
    if (!box.is_active) throw new PointsError("BOX_NOT_ACTIVE");

    const pool = (box.prizes || []).filter(isDrawable);
    if (!pool.some((p) => p.weight > 0)) throw new PointsError("NO_PRIZES_AVAILABLE");
    // Sin premios dentro la caja está agotada: no se abre ni se cobra.
    if (isBoxSoldOut(box.prizes || [])) throw new PointsError("BOX_SOLD_OUT");

    const { balance } = await assertCanSpend(userId);
    if (balance < box.price) throw new PointsError("INSUFFICIENT_POINTS");

    const reservation = await fairReserve(userId, 1);
    const prize = drawPrize(
      box,
      pool,
      fairUniform(reservation.server_seed, reservation.client_seed, reservation.nonce_start)
    );
    if (!prize) throw new PointsError("NO_PRIZES_AVAILABLE");

    const fair: FairState = {
      server_seed_hash: reservation.server_seed_hash,
      client_seed: reservation.client_seed,
      nonce: reservation.nonce_start,
    };

    try {
      const result = await openLootBoxFairAtomic(userId, boxId, prize.id, fair);
      return {
        opening_id: Number(result.opening_id),
        status: result.status,
        balance: result.balance,
        fair,
        prize: {
          id: prize.id,
          name: prize.name,
          description: prize.description,
          image: prize.image,
          rarity: prize.rarity,
          kind: result.kind,
          points: result.kind === "points" ? result.points_awarded : null,
          sold_out: false,
          fallback: result.fallback,
        },
      };
    } catch (err) {
      if (isPointsError(err) && (err.code === "PRIZE_OUT_OF_STOCK" || err.code === "PRIZE_UNAVAILABLE")) {
        continue;
      }
      throw err;
    }
  }
  throw new PointsError("NO_PRIZES_AVAILABLE");
}
