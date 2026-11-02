export type StoredSummary = {
  title: string;
  description: string | null;
  summary: string | null;
};

/** True when the row needs a fresh fallback written into the database. */
export function shouldReplaceSummary(
  existing: StoredSummary | undefined,
  video: { title: string; description: string },
): boolean {
  if (!existing) return true;
  const summary = existing.summary?.trim() ?? "";
  const corrupted = summary.startsWith("{");
  const missing = summary.length === 0 || corrupted;
  const changed = existing.title !== video.title || (existing.description ?? "") !== video.description;
  return missing || changed;
}
