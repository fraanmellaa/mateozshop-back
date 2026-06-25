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
