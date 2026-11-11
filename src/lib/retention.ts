/** Rank stored on rows that stay in the database but are outside the current top N. */
export const ARCHIVE_RANK = 1000;

export type RetentionPlan = {
  demoteIds: string[];
  excludeIds: string[];
};

/**
 * Videos that miss today's top N stay in the table.
 * Blocklisted ids are marked excluded and are not deleted.
 */
export function planCategoryRetention(
  existingIds: readonly string[],
  topIds: readonly string[],
  excludedIds: ReadonlySet<string>,
): RetentionPlan {
  const top = new Set(topIds);
  const demoteIds: string[] = [];
  const excludeIds: string[] = [];
  const seen = new Set<string>();
  for (const id of existingIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (excludedIds.has(id)) {
      excludeIds.push(id);
      continue;
    }
    if (!top.has(id)) demoteIds.push(id);
  }
  return { demoteIds, excludeIds };
}

export function videoIdsToDelete(): readonly string[] {
  return [];
}
