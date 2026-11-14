import { createHash } from "crypto";
import { jwtVerify } from "jose";

type PublishTaskParams = {
  destination: string;
  body: unknown;
  forwardHeaders?: Record<string, string>;
};

function getQStashBaseUrl() {
  return process.env.QSTASH_BASE_URL || "https://qstash.upstash.io";
}

export async function publishQStashTask(params: PublishTaskParams) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN_NOT_CONFIGURED");
  }

  const url = `${getQStashBaseUrl()}/v2/publish/${encodeURIComponent(
    params.destination
  )}`;

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  for (const [key, value] of Object.entries(params.forwardHeaders || {})) {
    headers.set(`Upstash-Forward-${key}`, value);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "QSTASH_PUBLISH_FAILED");
  }

  return payload;
}

export function hasQStashSigningKeys() {
  return Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY || process.env.QSTASH_NEXT_SIGNING_KEY
  );
}

/**
 * Verifica la cabecera `Upstash-Signature` de una entrega de QStash: un JWT
 * HS256 firmado con la clave de firma actual (o la siguiente, durante una
 * rotación) cuyo claim `body` es el SHA-256 en base64url del cuerpo recibido.
 */
export async function verifyQStashSignature(
  signature: string | null,
  rawBody: string
): Promise<boolean> {
  if (!signature) return false;

  const keys = [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((key): key is string => Boolean(key));

  const bodyHash = createHash("sha256").update(rawBody).digest("base64url");

  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(signature, new TextEncoder().encode(key), {
        issuer: "Upstash",
        algorithms: ["HS256"],
        clockTolerance: 5,
      });

      const claimed = typeof payload.body === "string" ? payload.body.replace(/=+$/, "") : "";
      if (claimed === bodyHash) return true;
    } catch {
      // Se prueba con la siguiente clave.
    }
  }

  return false;
}
