/** Skip Shorts and other low-effort clips. */
export const MIN_DURATION_SECONDS = 60;

export type RankableVideo = {
  youtube_id: string;
  view_count: number;
  published_at: string;
  duration_seconds: number;
};

/** Popular and recent beats either alone: view_count / (daysAgo + 2) ^ 1.4. */
export function hotRankScore(video: Pick<RankableVideo, "view_count" | "published_at">, nowMs: number): number {
  const publishedMs = new Date(video.published_at).getTime();
  const daysAgo = Number.isFinite(publishedMs) ? Math.max(0, (nowMs - publishedMs) / 86_400_000) : 0;
  return video.view_count / Math.pow(daysAgo + 2, 1.4);
}

/**
 * Top N for one category. Excluded ids and short videos never take a recommendation slot.
 * Equal scores keep a stable order by youtube_id.
 */
export function selectRankedTop<T extends RankableVideo>(
  videos: readonly T[],
  targetCount: number,
  excludedIds: ReadonlySet<string>,
  nowMs: number,
): T[] {
  return [...videos]
    .filter((video) => video.duration_seconds >= MIN_DURATION_SECONDS && !excludedIds.has(video.youtube_id))
    .sort((a, b) => {
      const score = hotRankScore(b, nowMs) - hotRankScore(a, nowMs);
      if (score !== 0) return score;
      return a.youtube_id.localeCompare(b.youtube_id);
    })
    .slice(0, Math.max(0, targetCount));
}

export function recommendationRanks(
  topIds: readonly string[],
): { youtube_id: string; rank: number; status: "published" }[] {
  return topIds.map((youtube_id, index) => ({
    youtube_id,
    rank: index + 1,
    status: "published" as const,
  }));
}
