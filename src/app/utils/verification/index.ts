import { createHash } from "node:crypto";

import sharp from "sharp";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { VipUnavailableError } from "@/app/utils/points/vip";
import { isMissingColumn, isMissingVipSchema } from "@/app/utils/products/currency";

/**
 * Verificación de afiliados (migración 0032). El usuario se registra en un
 * casino desde la página de Bonos, hace un primer depósito de 30 € o más y
 * envía el casino, su usuario de ese casino y dos capturas (correo de
 * bienvenida y depósito). El admin lo comprueba a mano y aprueba o rechaza.
 * Aprobar marca `users.is_verified` y cuenta un casino más para su tramo de
 * puntos VIP (1 casino, 2, o 3 o más).
 *
 * Las capturas (hasta 3 MB cada una) se suben de una en una, se convierten a
 * WebP y quedan como borrador del usuario hasta que envía la solicitud. Viven
 * en un bucket PRIVADO y solo mientras la solicitud está pendiente: se borran
 * al aprobar o rechazar. Lo único que queda guardado es
 * casino, usuario del casino, estado y fecha (el importe no se guarda nunca),
 * más la huella (SHA-256) de cada captura, que se conserva aunque la imagen se
 * borre: si otra cuenta sube la misma imagen, el panel lo avisa (migración 0035).
 *
 * Mientras la migración no esté aplicada, todo lanza VipUnavailableError.
 */

export type VerificationStatus = "pending" | "approved" | "rejected" | "revoked";

export type VerificationRequest = {
  id: number;
  user_id: number;
  casino: string;
  casino_username: string;
  status: VerificationStatus;
  note: string | null;
  created_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
};

export type VerificationErrorCode =
  | "INVALID_REQUEST"
  | "USER_NOT_FOUND"
  | "USER_BANNED"
  | "REQUEST_PENDING"
  | "CASINO_ALREADY_VERIFIED"
  | "CASINO_USER_TAKEN"
  | "REQUEST_NOT_FOUND"
  | "PROOF_REQUIRED";

const CODES = new Set<string>([
  "INVALID_REQUEST",
  "USER_NOT_FOUND",
  "USER_BANNED",
  "REQUEST_PENDING",
  "CASINO_ALREADY_VERIFIED",
  "CASINO_USER_TAKEN",
  "REQUEST_NOT_FOUND",
  "PROOF_REQUIRED",
]);

export class VerificationError extends Error {
  code: VerificationErrorCode;
  constructor(code: VerificationErrorCode) {
    super(code);
    this.name = "VerificationError";
    this.code = code;
  }
}

type DbError = { code?: string; message?: string };

function toError(error: DbError): Error {
  if (isMissingVipSchema(error)) return new VipUnavailableError();
  const message = String(error.message || "").trim();
  if (CODES.has(message)) return new VerificationError(message as VerificationErrorCode);
  return new Error(`Verification failed: ${message || "unknown error"}`);
}

const COLUMNS = "id, user_id, casino, casino_username, status, note, created_at, reviewed_at, reviewed_by";

// ───────────────────────── capturas (almacenamiento privado) ─────────────────────────

const PROOF_BUCKET = "verification-proofs";
/** Lo máximo que puede pesar la captura que sube el usuario. */
export const PROOF_MAX_BYTES = 3 * 1024 * 1024; // 3 MB por captura
// Lo máximo que se guarda ya convertida. El panel la sirve por una función del
// servidor, y en Vercel una respuesta no puede pasar de unos 4,5 MB.
const STORED_MAX_BYTES = 3 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60_000_000;
export type ProofKind = "welcome" | "deposit";

type Detected = { ext: "png" | "jpg" | "webp"; contentType: string };

/** Tipo de imagen por sus primeros bytes (no se fía del type del cliente). */
export function detectProofImage(bytes: Uint8Array): Detected | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", contentType: "image/png" };
  if (startsWith([0xff, 0xd8, 0xff])) return { ext: "jpg", contentType: "image/jpeg" };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

/**
 * Convierte la captura a WebP sin cambiar su tamaño en píxeles.
 *  · PNG y WebP (capturas de pantalla): WebP SIN pérdida, los píxeles quedan
 *    idénticos y normalmente pesa bastante menos.
 *  · JPEG (ya viene comprimido con pérdida; guardarlo sin pérdida lo haría
 *    pesar varias veces más): WebP de calidad muy alta, sin diferencia a la vista.
 * Si aun así pasara del tope guardado, baja la calidad lo justo hasta que quepa.
 * De paso se descartan los metadatos (EXIF, GPS) y cualquier cosa del archivo
 * que no sea la imagen. Devuelve null si el archivo no se puede abrir como
 * imagen o no hay forma de que quepa.
 */
export async function convertProofToWebp(bytes: Uint8Array): Promise<Uint8Array | null> {
  const kind = detectProofImage(bytes);
  if (!kind) return null;
  try {
    const source = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    if (kind.ext !== "jpg") {
      const lossless = await source().webp({ lossless: true, effort: 3 }).toBuffer();
      if (lossless.length <= STORED_MAX_BYTES) return new Uint8Array(lossless);
    }
    for (const quality of [95, 88, 78, 60]) {
      const out = await source().webp({ quality, effort: 3, smartSubsample: true }).toBuffer();
      if (out.length <= STORED_MAX_BYTES) return new Uint8Array(out);
    }
    return null;
  } catch {
    return null;
  }
}

const WEBP = "image/webp";
const draftPath = (userId: number, kind: ProofKind) => `u${userId}/draft-${kind}.webp`;

let bucketReady = false;

/**
 * El bucket se crea solo la primera vez, siempre privado (sin URL pública).
 * Si ya existía, se le vuelven a poner sus límites y se fuerza a privado.
 */
async function proofStorage() {
  const storage = getSupabaseAdmin().storage;
  if (!bucketReady) {
    const options = { public: false, fileSizeLimit: STORED_MAX_BYTES, allowedMimeTypes: [WEBP] };
    const { error } = await storage.createBucket(PROOF_BUCKET, options);
    if (error) {
      if (!/already exists|duplicate/i.test(String(error.message))) throw error;
      const { error: updateError } = await storage.updateBucket(PROOF_BUCKET, options);
      if (updateError) throw updateError;
    }
    bucketReady = true;
  }
  return storage.from(PROOF_BUCKET);
}

/**
 * Guarda una captura ya convertida como borrador del usuario. Hay un borrador
 * por usuario y tipo: subir otra lo sustituye, así que no se acumulan. Las
 * capturas llegan de una en una porque dos juntas no caben en una petición.
 */
export async function saveProofDraft(userId: number, kind: ProofKind, webp: Uint8Array) {
  const { error } = await (await proofStorage()).upload(draftPath(userId, kind), webp, {
    contentType: WEBP,
    upsert: true,
  });
  if (error) throw error;
}

async function readProofDraft(userId: number, kind: ProofKind): Promise<Uint8Array | null> {
  const { data, error } = await (await proofStorage()).download(draftPath(userId, kind));
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadProof(userId: number, kind: ProofKind, webp: Uint8Array) {
  const path = `u${userId}/${crypto.randomUUID()}-${kind}.webp`;
  const { error } = await (await proofStorage()).upload(path, webp, { contentType: WEBP, upsert: false });
  if (error) throw error;
  return path;
}

async function removeProofs(paths: Array<string | null | undefined>) {
  const list = paths.filter((p): p is string => Boolean(p));
  if (list.length === 0) return;
  const { error } = await (await proofStorage()).remove(list);
  if (error) throw error;
}

/**
 * Borra las capturas de las solicitudes ya resueltas y limpia sus rutas. Se
 * llama al resolver y también al listar, por si un borrado anterior falló.
 */
export async function purgeReviewedProofs(requestId?: number) {
  let query = getSupabaseAdmin()
    .from("verification_requests")
    .select("id, welcome_proof, deposit_proof")
    .neq("status", "pending")
    .or("welcome_proof.not.is.null,deposit_proof.not.is.null")
    .limit(200);
  if (requestId) query = query.eq("id", requestId);

  const { data, error } = await query;
  if (error) throw toError(error);

  for (const row of data ?? []) {
    await removeProofs([row.welcome_proof, row.deposit_proof]);
    const { error: clearError } = await getSupabaseAdmin()
      .from("verification_requests")
      .update({ welcome_proof: null, deposit_proof: null })
      .eq("id", row.id);
    if (clearError) throw toError(clearError);
  }
}

/** Una captura de una solicitud pendiente, para enseñarla en el panel. */
export async function getProofImage(
  requestId: number,
  kind: ProofKind
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("verification_requests")
    .select("status, welcome_proof, deposit_proof")
    .eq("id", requestId)
    .limit(1);
  if (error) throw toError(error);

  const row = data?.[0];
  const path = row?.status === "pending" ? (kind === "welcome" ? row.welcome_proof : row.deposit_proof) : null;
  if (!path) return null;

  const { data: blob, error: downloadError } = await (await proofStorage()).download(path);
  if (downloadError || !blob) return null;
  return { bytes: await blob.arrayBuffer(), contentType: blob.type || WEBP };
}

// ───────────────────────── solicitudes ─────────────────────────

/** Última solicitud del usuario (la pendiente, si la hay), o null. */
export async function getLatestVerificationRequest(userId: number): Promise<VerificationRequest | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("verification_requests")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw toError(error);
  return (data?.[0] as VerificationRequest | undefined) ?? null;
}

/** Todas las solicitudes del usuario, la más reciente primero. */
export async function listUserVerificationRequests(userId: number): Promise<VerificationRequest[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("verification_requests")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw toError(error);
  return (data ?? []) as VerificationRequest[];
}

/** Casinos en los que el usuario ya está verificado. */
export async function getVerifiedCasinos(userId: number): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("verification_requests")
    .select("casino")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: true });
  if (error) throw toError(error);
  return (data ?? []).map((row) => String(row.casino));
}

export type NewVerification = { casino: string; casinoUsername: string };

/**
 * Crea la solicitud con las dos capturas que el usuario dejó subidas como
 * borrador (PROOF_REQUIRED si falta alguna). Si la solicitud no se llega a
 * crear (ya hay una pendiente, el usuario de casino está cogido...), los
 * borradores se conservan para que pueda corregir y reenviar sin subirlas otra
 * vez; al crearse, se borran.
 */
export async function requestVerification(userId: number, input: NewVerification) {
  const [welcome, deposit] = await Promise.all([
    readProofDraft(userId, "welcome"),
    readProofDraft(userId, "deposit"),
  ]);
  if (!welcome || !deposit) throw new VerificationError("PROOF_REQUIRED");

  const paths: string[] = [];
  try {
    paths.push(await uploadProof(userId, "welcome", welcome));
    paths.push(await uploadProof(userId, "deposit", deposit));

    const { data, error } = await getSupabaseAdmin().rpc("verification_request", {
      p_user_id: userId,
      p_casino: input.casino,
      p_casino_username: input.casinoUsername,
      p_welcome_proof: paths[0],
      p_deposit_proof: paths[1],
    });
    if (error) throw toError(error);
    const created = data as { id: number; status: "pending"; casino: string; casino_username: string; created_at: number };

    // Huella de cada captura. Sin la migración 0035 no hay dónde guardarla y
    // la solicitud sigue adelante igual.
    const { error: hashError } = await getSupabaseAdmin()
      .from("verification_requests")
      .update({ welcome_hash: proofHash(welcome), deposit_hash: proofHash(deposit) })
      .eq("id", created.id);
    if (hashError && !isMissingHashColumn(hashError)) {
      console.error("[VERIFICATION] No se pudo guardar la huella de las capturas de la solicitud", created.id, hashError);
    }
    await removeProofs([draftPath(userId, "welcome"), draftPath(userId, "deposit")]).catch((cleanupError) =>
      console.error("[VERIFICATION] No se pudieron borrar los borradores de las capturas:", cleanupError)
    );
    return created;
  } catch (error) {
    await removeProofs(paths).catch((cleanupError) =>
      console.error("[VERIFICATION] No se pudieron borrar las capturas de una solicitud fallida:", cleanupError)
    );
    throw error;
  }
}

/** Huella de una captura: SHA-256 de la imagen ya convertida a WebP (la misma imagen da la misma huella). */
const proofHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const isMissingHashColumn = (error: unknown) =>
  isMissingColumn(error, "welcome_hash") || isMissingColumn(error, "deposit_hash");

/** Otra cuenta que subió una captura con la misma huella. */
export type RepeatedProof = { request_id: number; user_id: number; username: string | null; casino: string };

/**
 * Para cada solicitud, las solicitudes de OTRAS cuentas que comparten alguna
 * huella con ella. Sin la migración 0035 devuelve un mapa vacío.
 */
async function findRepeatedProofs(
  rows: Array<{ id: number; user_id: number; welcome_hash?: string | null; deposit_hash?: string | null }>
): Promise<Map<number, RepeatedProof[]>> {
  const repeated = new Map<number, RepeatedProof[]>();
  const hashes = [...new Set(rows.flatMap((row) => [row.welcome_hash, row.deposit_hash]).filter((h): h is string => Boolean(h)))];
  if (hashes.length === 0) return repeated;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: any[] = [];
  for (let i = 0; i < hashes.length; i += 100) {
    const chunk = hashes.slice(i, i + 100).join(",");
    const { data, error } = await getSupabaseAdmin()
      .from("verification_requests")
      .select("id, user_id, casino, welcome_hash, deposit_hash, user:users(username)")
      .or(`welcome_hash.in.(${chunk}),deposit_hash.in.(${chunk})`)
      .limit(1000);
    if (error) {
      if (isMissingHashColumn(error)) return repeated;
      throw toError(error);
    }
    matches.push(...(data ?? []));
  }

  for (const row of rows) {
    const own = new Set([row.welcome_hash, row.deposit_hash].filter(Boolean));
    if (own.size === 0) continue;
    const seen = new Set<number>();
    const list: RepeatedProof[] = [];
    for (const match of matches) {
      if (match.user_id === row.user_id || seen.has(match.id)) continue;
      if (!own.has(match.welcome_hash) && !own.has(match.deposit_hash)) continue;
      seen.add(match.id);
      const user = Array.isArray(match.user) ? match.user[0] : match.user;
      list.push({ request_id: match.id, user_id: match.user_id, username: user?.username ?? null, casino: String(match.casino) });
    }
    if (list.length > 0) repeated.set(row.id, list);
  }
  return repeated;
}

export type AdminVerificationRequest = VerificationRequest & {
  username: string | null;
  email: string | null;
  kick_username: string | null;
  twitch_username: string | null;
  /** Casinos en los que esa cuenta ya está verificada. */
  verified_casinos: number;
  has_proofs: boolean;
  /** Otras cuentas que han subido una captura idéntica a alguna de esta solicitud. */
  repeated_proofs: RepeatedProof[];
};

/** Solicitudes para el panel, las más antiguas primero dentro de cada estado. */
export async function listVerificationRequests(status?: VerificationStatus): Promise<AdminVerificationRequest[]> {
  // Restos de capturas de solicitudes ya resueltas: no deben quedar guardadas.
  await purgeReviewedProofs().catch((error) => {
    if (error instanceof VipUnavailableError) throw error;
    console.error("[VERIFICATION] No se pudieron limpiar capturas antiguas:", error);
  });

  const load = (withHashes: boolean) => {
    let query = getSupabaseAdmin()
      .from("verification_requests")
      .select(
        `${COLUMNS}, welcome_proof, deposit_proof${withHashes ? ", welcome_hash, deposit_hash" : ""}, user:users(username, email, kick_username, twitch_username, verified_casinos)`
      )
      .order("created_at", { ascending: status === "pending" })
      .limit(500);
    if (status) query = query.eq("status", status);
    return query;
  };

  // Sin la migración 0035 no hay huellas: se lista igual, sin el aviso.
  let { data, error } = await load(true);
  if (error && isMissingHashColumn(error)) ({ data, error } = await load(false));
  if (error) throw toError(error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repeated = await findRepeatedProofs((data ?? []) as any[]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    const { user: _user, welcome_proof, deposit_proof, welcome_hash: _wh, deposit_hash: _dh, ...rest } = row;
    void _user;
    void _wh;
    void _dh;
    return {
      ...rest,
      username: user?.username ?? null,
      email: user?.email ?? null,
      kick_username: user?.kick_username ?? null,
      twitch_username: user?.twitch_username ?? null,
      verified_casinos: Number(user?.verified_casinos ?? 0),
      has_proofs: Boolean(welcome_proof && deposit_proof),
      repeated_proofs: repeated.get(row.id) ?? [],
    } as AdminVerificationRequest;
  });
}

/** Aprueba (verifica al usuario) o rechaza una solicitud pendiente, y borra sus capturas. */
export async function reviewVerification(requestId: number, approve: boolean, admin: string, note: string | null) {
  const { data, error } = await getSupabaseAdmin().rpc("verification_review", {
    p_request_id: requestId,
    p_approve: approve,
    p_admin: admin,
    p_note: note,
  });
  if (error) throw toError(error);

  // La decisión ya es firme: si el borrado falla aquí, se reintenta al listar.
  await purgeReviewedProofs(requestId).catch((purgeError) =>
    console.error("[VERIFICATION] No se pudieron borrar las capturas de la solicitud", requestId, purgeError)
  );
  return data as {
    action: "approved" | "rejected" | "none";
    user_id: number;
    casinos?: number | null;
    status?: VerificationStatus;
  };
}

/** Retira una verificación ya aprobada (ese casino deja de contar). */
export async function revokeVerification(requestId: number, admin: string, note: string | null) {
  const { data, error } = await getSupabaseAdmin().rpc("verification_revoke", {
    p_request_id: requestId,
    p_admin: admin,
    p_note: note,
  });
  if (error) throw toError(error);
  return data as { action: "revoked" | "none"; user_id: number; casinos?: number; status?: VerificationStatus };
}

/** Cuentas verificadas ahora mismo (contador público de la página de verificación). */
export async function countVerifiedUsers(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("is_verified", true);
  if (error) throw toError(error);
  return count ?? 0;
}

/**
 * Baja de cuenta: borra las capturas y las solicitudes del usuario y le quita
 * la verificación. No lanza: la baja ya está hecha cuando se llama.
 */
export async function removeUserVerification(userId: number) {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("verification_requests")
      .select("welcome_proof, deposit_proof")
      .eq("user_id", userId);
    if (error) throw toError(error);

    await removeProofs([
      ...(data ?? []).flatMap((row) => [row.welcome_proof, row.deposit_proof]),
      draftPath(userId, "welcome"),
      draftPath(userId, "deposit"),
    ]);
    const { error: deleteError } = await db.from("verification_requests").delete().eq("user_id", userId);
    if (deleteError) throw toError(deleteError);
    const { error: userError } = await db
      .from("users")
      .update({ is_verified: false, verified_casinos: 0, verified_at: null })
      .eq("id", userId);
    if (userError) throw toError(userError);
  } catch (error) {
    if (error instanceof VipUnavailableError) return; // sin la migración 0032 no hay nada que borrar
    console.error("[VERIFICATION] No se pudo limpiar la verificación de la cuenta dada de baja", userId, error);
  }
}
