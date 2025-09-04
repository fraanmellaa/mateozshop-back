const CLOUDFLARE_KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}`;

export async function kvGet(key: string) {
  const res = await fetch(`${BASE_URL}/values/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
  });

  if (!res.ok) return null;
  return await res.json();
}

export async function kvPut(key: string, value: object | string | number) {
  await fetch(`${BASE_URL}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

export async function kvList(prefix: string) {
  const res = await fetch(
    `${BASE_URL}/keys?prefix=${encodeURIComponent(prefix)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      },
    }
  );

  if (!res.ok) return null;
  return await res.json();
}

export async function kvDelete(key: string) {
  const res = await fetch(`${BASE_URL}/values/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
  });
  if (!res.ok) return null;
  return await res.json();
}
