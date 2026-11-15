import { createPublicKey, createVerify } from "crypto";

import { getAppAccessToken } from "@/app/api/utils";

const PUBLIC_KEY_URL = "https://api.kick.com/public/v1/public-key";
const KEY_TTL_MS = 60 * 60_000;
const KEY_MIN_REFETCH_MS = 60_000;

let cachedKey: { pem: string; fetchedAt: number } | null = null;

async function loadPublicKey(force: boolean): Promise<string | null> {
  // Clave fija opcional: evita depender de la API en cada arranque en frío.
  const fixed = process.env.KICK_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n").trim();
  if (fixed) return fixed;

  const now = Date.now();
  if (
    cachedKey &&
    (force ? now - cachedKey.fetchedAt < KEY_MIN_REFETCH_MS : now - cachedKey.fetchedAt < KEY_TTL_MS)
  ) {
    return cachedKey.pem;
  }

  try {
    const headers: Record<string, string> = {};
    try {
      headers.Authorization = `Bearer ${await getAppAccessToken()}`;
    } catch {
      // El endpoint de la clave pública no debería exigir token: se intenta sin él.
    }
    const res = await fetch(PUBLIC_KEY_URL, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const pem = (await res.json())?.data?.public_key;
    if (typeof pem !== "string" || !pem.includes("BEGIN PUBLIC KEY")) {
      throw new Error("unexpected body");
    }
    cachedKey = { pem, fetchedAt: now };
    return pem;
  } catch (error) {
    console.error("Kick public key unavailable:", error);
    return cachedKey?.pem ?? null;
  }
}

function verifyWith(pem: string, signedPayload: string, signature: string): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signedPayload);
    verifier.end();
    return verifier.verify(createPublicKey(pem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/**
 * Verifica la firma de un webhook de Kick: RSA-SHA256 sobre
 * `${messageId}.${timestamp}.${rawBody}` con la clave pública de Kick. Falla en
 * cerrado: sin clave o sin cabeceras devuelve false. Si falla con la clave en
 * caché, la vuelve a pedir una vez (rotación de clave).
 */
export async function verifyKickSignature(input: {
  messageId: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}): Promise<boolean> {
  const { messageId, timestamp, signature, rawBody } = input;
  if (!messageId || !timestamp || !signature) return false;

  const payload = `${messageId}.${timestamp}.${rawBody}`;

  const pem = await loadPublicKey(false);
  if (!pem) return false;
  if (verifyWith(pem, payload, signature)) return true;

  const fresh = await loadPublicKey(true);
  return fresh !== null && fresh !== pem && verifyWith(fresh, payload, signature);
}
