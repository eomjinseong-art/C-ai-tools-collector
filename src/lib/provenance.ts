export const PROVENANCE_COLUMNS = [
  "summary_source",
  "summary_generated_at",
  "summary_verified_at",
  "source_cues",
  "useful_facts",
  "costs",
  "limitations",
] as const;

export type ProvenanceColumn = (typeof PROVENANCE_COLUMNS)[number];

export const VIDEO_BASE_COLUMNS =
  "youtube_id, title, description, summary, summary_points, hook, tool_features, difficulty, takeaway, transcript_lang";

export const VIDEO_COLUMNS_WITH_PROVENANCE = `${VIDEO_BASE_COLUMNS}, ${PROVENANCE_COLUMNS.join(", ")}`;

type PostgrestLikeError = {
  code?: string;
  message?: string;
};

/** PostgREST schema-cache miss or Postgres undefined_column. */
export function isMissingColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const message = error.message ?? "";
  return /could not find the ['"][^'"]+['"] column/i.test(message) || /column ["']?[\w.]+["']? does not exist/i.test(message);
}

export function omitProvenance<T extends Record<string, unknown>>(row: T): Omit<T, ProvenanceColumn> {
  const next = { ...row };
  for (const key of PROVENANCE_COLUMNS) delete next[key];
  return next;
}

export function rowsForSchema<T extends Record<string, unknown>>(
  rows: readonly T[],
  provenanceWritable: boolean,
): T[] {
  if (provenanceWritable) return [...rows];
  return rows.map((row) => omitProvenance(row) as T);
}
