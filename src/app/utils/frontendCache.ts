const FRONT_CACHE_TAGS = {
  pastLeaderboards: "past-leaderboards-list",
  pastAuctions: "past-auctions-list",
  pastGiveaways: "past-giveaways-list",
} as const;

export async function purgeFrontendCacheByTags(tags: string[]) {
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL;
  const purgeSecret = process.env.FRONTEND_CACHE_PURGE_SECRET;

  if (!frontendBaseUrl || !purgeSecret) {
    return {
      success: false,
      skipped: true,
      reason: "FRONTEND_PURGE_CONFIG_MISSING",
    };
  }

  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  if (uniqueTags.length === 0) {
    return {
      success: true,
      skipped: true,
      purged: [],
    };
  }

  const url = new URL("/api/cache/purge", frontendBaseUrl);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${purgeSecret}`,
    },
    body: JSON.stringify({ tags: uniqueTags }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      success: false,
      skipped: false,
      reason: payload?.error || "FRONTEND_PURGE_FAILED",
      status: response.status,
    };
  }

  return {
    success: true,
    skipped: false,
    purged: Array.isArray(payload?.purged) ? payload.purged : uniqueTags,
  };
}

export async function purgePastAuctionsCache() {
  return purgeFrontendCacheByTags([FRONT_CACHE_TAGS.pastAuctions]);
}

export async function purgePastGiveawaysCache() {
  return purgeFrontendCacheByTags([FRONT_CACHE_TAGS.pastGiveaways]);
}

export async function purgePastLeaderboardsCache() {
  return purgeFrontendCacheByTags([FRONT_CACHE_TAGS.pastLeaderboards]);
}
