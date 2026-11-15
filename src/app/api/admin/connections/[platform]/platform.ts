import type { StreamerPlatform } from "@/app/utils/live/connections";

export function parsePlatform(value: string): StreamerPlatform | null {
  return value === "kick" || value === "twitch" ? value : null;
}
